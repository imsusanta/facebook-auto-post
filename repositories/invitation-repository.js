'use strict';

const crypto = require('crypto');
const { query, withTransaction } = require('../db/index');
const { generateUuid, isValidUuid } = require('../db/uuid');

const ALLOWED_INVITE_ROLES = ['admin', 'editor', 'reviewer', 'viewer'];

function hashToken(token) {
  return crypto.createHash('sha256').update(token.trim(), 'utf8').digest('hex');
}

class InvitationRepository {
  async createInvitation({ workspaceId, email, role, invitedBy = null, ttlHours = 72 }, client = null) {
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

    // Check if user is already an active member of this workspace
    const activeMemberCheckSql = `
      SELECT wm.status
      FROM users u
      JOIN workspace_members wm ON u.id = wm.user_id
      WHERE u.email_normalized = $1
        AND wm.workspace_id = $2
        AND u.deleted_at IS NULL;
    `;
    const memberCheckRes = client
      ? await client.query(activeMemberCheckSql, [emailNormalized, workspaceId])
      : await query(activeMemberCheckSql, [emailNormalized, workspaceId]);

    if (memberCheckRes.rows.length > 0 && memberCheckRes.rows[0].status === 'active') {
      const err = new Error('User is already an active member of this workspace');
      err.code = 'CONFLICT';
      throw err;
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
      const { rows } = client ? await client.query(sql, params) : await query(sql, params);
      return {
        invitation: rows[0],
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

  async revokeInvitation({ workspaceId, invitationId }, client = null) {
    if (!isValidUuid(workspaceId) || !isValidUuid(invitationId)) {
      throw new Error('Invalid workspaceId or invitationId');
    }

    const sql = `
      UPDATE workspace_invitations
      SET status = 'revoked'
      WHERE id = $1 AND workspace_id = $2 AND status = 'pending'
      RETURNING id, status;
    `;
    const { rows } = client ? await client.query(sql, [invitationId, workspaceId]) : await query(sql, [invitationId, workspaceId]);
    if (rows.length === 0) {
      throw new Error('Invitation not found or already inactive');
    }
    return rows[0];
  }

  async acceptInvitation({ token, userId }) {
    if (!token || typeof token !== 'string' || !token.trim()) {
      throw new Error('Valid invitation token is required');
    }
    if (!isValidUuid(userId)) {
      throw new Error('Valid userId is required');
    }

    const tokenHash = hashToken(token);

    return withTransaction(async (client) => {
      // 1. Lock invitation row
      const selectSql = `
        SELECT * FROM workspace_invitations
        WHERE token_hash = $1
        FOR UPDATE;
      `;
      const { rows: inviteRows } = await client.query(selectSql, [tokenHash]);
      const invite = inviteRows[0];

      if (!invite) {
        throw new Error('Invitation is invalid or does not exist');
      }

      if (invite.status !== 'pending') {
        throw new Error(`Invitation has already been ${invite.status}`);
      }

      if (new Date(invite.expires_at) <= new Date()) {
        await client.query("UPDATE workspace_invitations SET status = 'expired' WHERE id = $1;", [invite.id]);
        throw new Error('Invitation has expired');
      }

      // 2. Lock and verify accepting user
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

      // 3. Check for existing membership and handle idempotent / reactivation
      const memberSql = `
        SELECT workspace_id, user_id, role, status
        FROM workspace_members
        WHERE workspace_id = $1 AND user_id = $2
        FOR UPDATE;
      `;
      const { rows: memberRows } = await client.query(memberSql, [invite.workspace_id, user.id]);
      const existingMember = memberRows[0];

      if (existingMember) {
        if (existingMember.status === 'active') {
          throw new Error('User is already an active member of this workspace');
        }
        // Reactivate suspended or removed member
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

      // 4. Mark invitation accepted
      const updateInviteSql = `
        UPDATE workspace_invitations
        SET status = 'accepted', accepted_at = NOW()
        WHERE id = $1
        RETURNING id, workspace_id, role, status, accepted_at;
      `;
      const { rows: updatedInviteRows } = await client.query(updateInviteSql, [invite.id]);
      return updatedInviteRows[0];
    });
  }
}

module.exports = new InvitationRepository();
