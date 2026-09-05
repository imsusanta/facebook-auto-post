'use strict';

const crypto = require('crypto');
const { query, withTransaction } = require('../db/index');
const { generateUuid, isValidUuid } = require('../db/uuid');
const auditLogRepository = require('./audit-log-repository');

const ALLOWED_INVITE_ROLES = ['admin', 'editor', 'reviewer', 'viewer'];

function hashToken(token) {
  return crypto.createHash('sha256').update(token.trim(), 'utf8').digest('hex');
}

class InvitationRepository {
  async createInvitation({ workspaceId, email, role, invitedBy = null, ttlHours = 72, requestId = null }, clientOverride = null) {
    if (!isValidUuid(workspaceId)) {
      throw new Error('Invalid workspaceId UUID');
    }
    if (invitedBy !== null && invitedBy !== undefined && !isValidUuid(invitedBy)) {
      throw new Error('Invalid invitedBy UUID');
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new Error('Valid email address is required');
    }
    if (!ALLOWED_INVITE_ROLES.includes(role)) {
      throw new Error(`Invalid invitation role: ${role}. Invitations cannot grant the "owner" role.`);
    }
    if (typeof ttlHours !== 'number' || !Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > 168) {
      throw new Error('ttlHours must be an integer between 1 and 168');
    }

    const emailNormalized = email.trim().toLowerCase();

    const executeInTx = async (client) => {
      // 1. Lock workspace: verify active and not deleted
      const { rows: wsRows } = await client.query(
        'SELECT id, status, deleted_at FROM workspaces WHERE id = $1 AND status = $2 AND deleted_at IS NULL FOR UPDATE',
        [workspaceId, 'active']
      );
      if (wsRows.length === 0) {
        throw new Error('Workspace not found or inactive');
      }

      // 2. Transactionally expire stale pending invites for this email to prevent unique index deadlock
      await client.query(
        `UPDATE workspace_invitations
         SET status = 'expired'
         WHERE workspace_id = $1
           AND email_normalized = $2
           AND status = 'pending'
           AND expires_at <= NOW()`,
        [workspaceId, emailNormalized]
      );

      // 3. Check existing membership: active or suspended members cannot receive invites
      const activeMemberCheckSql = `
        SELECT wm.status
        FROM users u
        JOIN workspace_members wm ON u.id = wm.user_id
        WHERE u.email_normalized = $1
          AND wm.workspace_id = $2
          AND u.deleted_at IS NULL;
      `;
      const { rows: memberRows } = await client.query(activeMemberCheckSql, [emailNormalized, workspaceId]);
      if (memberRows.length > 0) {
        if (memberRows[0].status === 'active') {
          const err = new Error('User is already an active member of this workspace');
          err.code = 'CONFLICT';
          throw err;
        }
        if (memberRows[0].status === 'suspended') {
          const err = new Error('User is a suspended member of this workspace and cannot be invited. Membership must be reinstated directly by an owner or administrator.');
          err.code = 'CONFLICT';
          throw err;
        }
      }

      const id = generateUuid();
      const plaintextToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashToken(plaintextToken);
      const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);

      const sql = `
        INSERT INTO workspace_invitations (
          id, workspace_id, email_normalized, role, token_hash, invited_by, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, workspace_id, email_normalized, role, status, expires_at, created_at;
      `;
      const params = [id, workspaceId, emailNormalized, role, tokenHash, invitedBy || null, expiresAt];

      try {
        const { rows } = await client.query(sql, params);
        const invitation = rows[0];

        // Atomically record audit event inside transaction
        await auditLogRepository.recordEvent({
          workspaceId,
          actorUserId: invitedBy,
          action: 'invitation:created',
          resourceType: 'invitation',
          resourceId: invitation.id,
          requestId,
          metadata: {
            emailNormalized,
            role
          }
        }, client);

        return {
          invitation,
          token: plaintextToken // Returned once at creation for delivery; never stored in plaintext
        };
      } catch (err) {
        if (err.code === '23505') {
          const conflictErr = new Error('A pending invitation already exists for this email address');
          conflictErr.code = 'CONFLICT';
          throw conflictErr;
        }
        throw err;
      }
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }

  async listByWorkspace({ workspaceId }, client = null) {
    if (!isValidUuid(workspaceId)) return [];

    const sql = `
      SELECT id, workspace_id, email_normalized, role, status, expires_at, created_at, accepted_at
      FROM workspace_invitations
      WHERE workspace_id = $1 AND status != 'revoked'
      ORDER BY created_at DESC;
    `;
    const { rows } = client ? await client.query(sql, [workspaceId]) : await query(sql, [workspaceId]);
    return rows;
  }

  async revokeInvitation({ workspaceId, invitationId, actorUserId = null, requestId = null }, clientOverride = null) {
    if (!isValidUuid(workspaceId) || !isValidUuid(invitationId)) {
      throw new Error('Invalid workspaceId or invitationId');
    }

    const executeInTx = async (client) => {
      // 1. Lock workspace
      const { rows: wsRows } = await client.query(
        'SELECT id, status, deleted_at FROM workspaces WHERE id = $1 AND status = $2 AND deleted_at IS NULL FOR UPDATE',
        [workspaceId, 'active']
      );
      if (wsRows.length === 0) {
        throw new Error('Workspace not found or inactive');
      }

      // 2. Lock & revoke invitation
      const sql = `
        UPDATE workspace_invitations
        SET status = 'revoked'
        WHERE id = $1 AND workspace_id = $2 AND status = 'pending'
        RETURNING id, status;
      `;
      const { rows } = await client.query(sql, [invitationId, workspaceId]);
      if (rows.length === 0) {
        throw new Error('Invitation not found or already inactive');
      }

      // Atomically record audit event inside transaction
      await auditLogRepository.recordEvent({
        workspaceId,
        actorUserId,
        action: 'invitation:revoked',
        resourceType: 'invitation',
        resourceId: invitationId,
        requestId,
        metadata: { invitationId }
      }, client);

      return rows[0];
    };

    return clientOverride ? executeInTx(clientOverride) : withTransaction(executeInTx);
  }

  async acceptInvitation({ token, userId, requestId = null }) {
    if (!token || typeof token !== 'string' || !token.trim()) {
      throw new Error('Valid invitation token is required');
    }
    if (!isValidUuid(userId)) {
      throw new Error('Valid userId is required');
    }

    const tokenHash = hashToken(token);

    // Preliminary status check to persist expiration without transaction rollback
    const { rows: checkRows } = await query(
      'SELECT id, workspace_id, status, expires_at FROM workspace_invitations WHERE token_hash = $1',
      [tokenHash]
    );
    const candidate = checkRows[0];
    if (!candidate) {
      throw new Error('Invitation is invalid or does not exist');
    }
    if (candidate.status !== 'pending') {
      throw new Error(`Invitation has already been ${candidate.status}`);
    }
    if (new Date(candidate.expires_at) <= new Date()) {
      await query("UPDATE workspace_invitations SET status = 'expired' WHERE id = $1", [candidate.id]);
      throw new Error('Invitation has expired');
    }

    return withTransaction(async (client) => {
      // Canonical Lock Ordering: 1. workspaces -> 2. invitations -> 3. members -> 4. users

      // 1. Lock workspace: verify active and not deleted
      const { rows: wsRows } = await client.query(
        'SELECT id, status, deleted_at FROM workspaces WHERE id = $1 FOR UPDATE',
        [candidate.workspace_id]
      );
      const ws = wsRows[0];
      if (!ws || ws.status !== 'active' || ws.deleted_at !== null) {
        throw new Error('Workspace not found or inactive');
      }

      // 2. Lock invitation row
      const selectSql = `
        SELECT * FROM workspace_invitations
        WHERE token_hash = $1 AND workspace_id = $2
        FOR UPDATE;
      `;
      const { rows: inviteRows } = await client.query(selectSql, [tokenHash, ws.id]);
      const invite = inviteRows[0];

      if (!invite) {
        throw new Error('Invitation is invalid or does not exist');
      }
      if (invite.status !== 'pending') {
        throw new Error(`Invitation has already been ${invite.status}`);
      }
      if (new Date(invite.expires_at) <= new Date()) {
        throw new Error('Invitation has expired');
      }

      // 3. Lock existing membership if any
      const memberSql = `
        SELECT workspace_id, user_id, role, status
        FROM workspace_members
        WHERE workspace_id = $1 AND user_id = $2
        FOR UPDATE;
      `;
      const { rows: memberRows } = await client.query(memberSql, [invite.workspace_id, userId]);
      const existingMember = memberRows[0];

      // 4. Lock and verify accepting user
      const userSql = `
        SELECT id, email, email_normalized, status, email_verified_at, deleted_at
        FROM users
        WHERE id = $1 AND deleted_at IS NULL
        FOR UPDATE;
      `;
      const { rows: userRows } = await client.query(userSql, [userId]);
      const user = userRows[0];

      if (!user) {
        throw new Error('User not found or inactive');
      }
      if (user.status !== 'active') {
        throw new Error('User account is suspended or inactive');
      }
      if (!user.email_verified_at) {
        throw new Error('Email must be verified before accepting workspace invitations');
      }
      if (user.email_normalized !== invite.email_normalized) {
        // Generic security message to prevent email/token probing
        throw new Error('Invitation is invalid or does not match this account');
      }

      // Verify issuing inviter retains authority (if invited_by is set)
      if (invite.invited_by) {
        const inviterSql = `
          SELECT wm.role, wm.status as member_status, u.status as user_status, u.deleted_at as user_deleted_at
          FROM workspace_members wm
          JOIN users u ON wm.user_id = u.id
          WHERE wm.workspace_id = $1 AND wm.user_id = $2;
        `;
        const { rows: inviterRows } = await client.query(inviterSql, [invite.workspace_id, invite.invited_by]);
        const inviter = inviterRows[0];

        if (
          !inviter ||
          inviter.member_status !== 'active' ||
          inviter.user_status !== 'active' ||
          inviter.user_deleted_at !== null ||
          (inviter.role !== 'owner' && inviter.role !== 'admin')
        ) {
          throw new Error('Invitation is no longer valid because the issuing inviter no longer possesses administrative authority in this workspace');
        }
      }

      // Membership state transitions:
      if (existingMember) {
        if (existingMember.status === 'active') {
          throw new Error('User is already an active member of this workspace');
        }
        if (existingMember.status === 'suspended') {
          throw new Error('Suspended members cannot reactivate their membership via invitation. An active workspace owner or administrator must reinstate the membership.');
        }
        // Reactivate removed member with fresh authorized invitation
        const updateMemberSql = `
          UPDATE workspace_members
          SET status = 'active', role = $1, invited_by = $2, updated_at = NOW()
          WHERE workspace_id = $3 AND user_id = $4
          RETURNING *;
        `;
        await client.query(updateMemberSql, [invite.role, invite.invited_by, invite.workspace_id, user.id]);
      } else {
        const insertMemberSql = `
          INSERT INTO workspace_members (workspace_id, user_id, role, status, invited_by)
          VALUES ($1, $2, $3, 'active', $4)
          RETURNING *;
        `;
        await client.query(insertMemberSql, [invite.workspace_id, user.id, invite.role, invite.invited_by]);
      }

      // Mark invitation accepted
      const updateInviteSql = `
        UPDATE workspace_invitations
        SET status = 'accepted', accepted_at = NOW()
        WHERE id = $1
        RETURNING id, workspace_id, role, status, accepted_at;
      `;
      const { rows: updatedInviteRows } = await client.query(updateInviteSql, [invite.id]);

      // Atomically record audit event inside transaction
      await auditLogRepository.recordEvent({
        workspaceId: invite.workspace_id,
        actorUserId: user.id,
        action: 'invitation:accepted',
        resourceType: 'invitation',
        resourceId: invite.id,
        requestId,
        metadata: {
          acceptedByUserId: user.id,
          role: invite.role
        }
      }, client);

      return updatedInviteRows[0];
    });
  }
}

module.exports = new InvitationRepository();
