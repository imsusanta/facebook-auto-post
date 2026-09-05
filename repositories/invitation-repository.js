'use strict';
const { publicError } = require('../security/public-error');

const crypto = require('crypto');
const { query, withTransaction } = require('../db/index');
const { generateUuid, isValidUuid } = require('../db/uuid');
const auditLogRepository = require('./audit-log-repository');

const { lockPrincipals, requireAdministrator } = require('./authorization-locks');

const ALLOWED_INVITE_ROLES = ['admin', 'editor', 'reviewer', 'viewer'];

function hashToken(token) {
  return crypto.createHash('sha256').update(token.trim(), 'utf8').digest('hex');
}

class InvitationRepository {
  async createInvitation({ workspaceId, email, role, invitedBy = null, ttlHours = 72, requestId = null }, clientOverride = null) {
    if (!isValidUuid(workspaceId)) {
      throw publicError('VALIDATION_FAILED', 'Invalid workspaceId UUID');
    }
    if (!isValidUuid(invitedBy)) {
      throw publicError('VALIDATION_FAILED', 'Invalid invitedBy UUID');
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw publicError('VALIDATION_FAILED', 'Valid email address is required');
    }
    if (!ALLOWED_INVITE_ROLES.includes(role)) {
      throw publicError('VALIDATION_FAILED', `Invalid invitation role: ${role}. Invitations cannot grant the "owner" role.`);
    }
    if (typeof ttlHours !== 'number' || !Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > 168) {
      throw publicError('VALIDATION_FAILED', 'ttlHours must be an integer between 1 and 168');
    }

    const emailNormalized = email.trim().toLowerCase();

    const executeInTx = async (client) => {
      // 1. Lock workspace: verify active and not deleted
      const { rows: wsRows } = await client.query(
        'SELECT id, status, deleted_at FROM workspaces WHERE id = $1 AND status = $2 AND deleted_at IS NULL FOR UPDATE',
        [workspaceId, 'active']
      );
      if (wsRows.length === 0) {
        throw publicError('WORKSPACE_NOT_FOUND', 'Workspace not found or inactive');
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

      const principals = await lockPrincipals(client, workspaceId, [invitedBy]);
      requireAdministrator(principals, invitedBy);

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
          const err = publicError('CONFLICT', 'User is already an active member of this workspace');
          err.code = 'CONFLICT';
          throw err;
        }
        if (memberRows[0].status === 'suspended') {
          const err = publicError('CONFLICT', 'User is a suspended member of this workspace and cannot be invited. Membership must be reinstated directly by an owner or administrator.');
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
          const conflictErr = publicError('CONFLICT', 'A pending invitation already exists for this email address');
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
      throw publicError('VALIDATION_FAILED', 'Invalid workspaceId or invitationId');
    }

    const executeInTx = async (client) => {
      // 1. Lock workspace
      const { rows: wsRows } = await client.query(
        'SELECT id, status, deleted_at FROM workspaces WHERE id = $1 AND status = $2 AND deleted_at IS NULL FOR UPDATE',
        [workspaceId, 'active']
      );
      if (wsRows.length === 0) {
        throw publicError('WORKSPACE_NOT_FOUND', 'Workspace not found or inactive');
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
        throw publicError('WORKSPACE_NOT_FOUND', 'Invitation not found or already inactive');
      }

      const principals = await lockPrincipals(client, workspaceId, [actorUserId]);
      requireAdministrator(principals, actorUserId);

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
      throw publicError('VALIDATION_FAILED', 'Valid invitation token is required');
    }
    if (!isValidUuid(userId)) {
      throw publicError('VALIDATION_FAILED', 'Valid userId is required');
    }

    const tokenHash = hashToken(token);

    // Preliminary status check to persist expiration without transaction rollback
    const { rows: checkRows } = await query(
      'SELECT id, workspace_id, status, expires_at FROM workspace_invitations WHERE token_hash = $1',
      [tokenHash]
    );
    const candidate = checkRows[0];
    if (!candidate) {
      throw publicError('INVITATION_INVALID', 'Invitation is invalid or does not exist');
    }
    const outcome = await withTransaction(async (client) => {
      // Canonical Lock Ordering: 1. workspaces -> 2. invitations -> 3. members -> 4. users

      // 1. Lock workspace: verify active and not deleted
      const { rows: wsRows } = await client.query(
        'SELECT id, status, deleted_at FROM workspaces WHERE id = $1 FOR UPDATE',
        [candidate.workspace_id]
      );
      const ws = wsRows[0];
      if (!ws || ws.status !== 'active' || ws.deleted_at !== null) {
        throw publicError('WORKSPACE_NOT_FOUND', 'Workspace not found or inactive');
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
        throw publicError('INVITATION_INVALID', 'Invitation is invalid or does not exist');
      }
      if (invite.status !== 'pending') {
        throw publicError('INVITATION_INVALID', `Invitation has already been ${invite.status}`);
      }
      // Use database time and a conditional transition. Return an error outcome
      // instead of throwing inside the transaction so expiration commits safely.
      const expired = await client.query("UPDATE workspace_invitations SET status = 'expired' WHERE id = $1 AND status = 'pending' AND expires_at <= clock_timestamp() RETURNING id", [invite.id]);
      if (expired.rowCount) return { expired: true };

      const principals = await lockPrincipals(client, invite.workspace_id, [userId, invite.invited_by]);
      const user = principals.users.get(userId);
      const existingMember = principals.members.get(userId);
      if (!user || user.status !== 'active' || user.deleted_at !== null) throw publicError('WORKSPACE_NOT_FOUND', 'User not found or inactive');
      if (!user.email_verified_at) throw publicError('INVITATION_INVALID', 'Email must be verified before accepting workspace invitations');
      if (user.email_normalized !== invite.email_normalized) throw publicError('INVITATION_INVALID', 'Invitation is invalid or does not match this account');
      // Invitations without an identifiable, still-authorized issuer fail closed.
      requireAdministrator(principals, invite.invited_by);

      // Membership state transitions:
      if (existingMember) {
        if (existingMember.status === 'active') {
          throw publicError('CONFLICT', 'User is already an active member of this workspace');
        }
        if (existingMember.status === 'suspended') {
          throw publicError('PERMISSION_DENIED', 'Suspended members cannot reactivate their membership via invitation. An active workspace owner or administrator must reinstate the membership.');
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
        WHERE id = $1 AND status = 'pending' AND expires_at > clock_timestamp()
        RETURNING id, workspace_id, role, status, accepted_at;
      `;
      const { rows: updatedInviteRows } = await client.query(updateInviteSql, [invite.id]);

      if (!updatedInviteRows[0]) throw publicError('INVITATION_INVALID', 'Invitation has expired');

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

      return { accepted: updatedInviteRows[0] };
    });
    if (outcome.expired) throw publicError('INVITATION_INVALID', 'Invitation has expired');
    return outcome.accepted;
  }
}

module.exports = new InvitationRepository();
