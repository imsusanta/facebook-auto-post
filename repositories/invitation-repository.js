'use strict';

const crypto = require('crypto');
const { query, withTransaction } = require('../db/index');
const { generateUuidV7, isValidUuid } = require('../db/uuid');
const membershipRepository = require('./membership-repository');

const ALLOWED_INVITE_ROLES = ['admin', 'editor', 'reviewer', 'viewer'];

function hashToken(token) {
  return crypto.createHash('sha256').update(token.trim(), 'utf8').digest('hex');
}

class InvitationRepository {
  async createInvitation({ workspaceId, email, role, invitedBy, ttlHours = 168 }, client = null) {
    if (!isValidUuid(workspaceId) || !isValidUuid(invitedBy)) {
      throw new Error('Invalid workspaceId or invitedBy UUID');
    }
    if (!email || !email.includes('@')) {
      throw new Error('Valid email address is required');
    }
    if (!ALLOWED_INVITE_ROLES.includes(role)) {
      throw new Error(`Invalid invitation role: ${role}. Invitations cannot grant the "owner" role.`);
    }

    const emailNormalized = email.trim().toLowerCase();
    const id = generateUuidV7();
    const plaintextToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(plaintextToken);
    const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);

    const sql = `
      INSERT INTO workspace_invitations (
        id, workspace_id, email_normalized, role, token_hash, invited_by, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, workspace_id, email_normalized, role, status, expires_at, created_at;
    `;
    const params = [id, workspaceId, emailNormalized, role, tokenHash, invitedBy, expiresAt];

    const { rows } = client ? await client.query(sql, params) : await query(sql, params);
    return {
      invitation: rows[0],
      token: plaintextToken // Returned once at creation for delivery; never stored in plaintext
    };
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
    if (!token || typeof token !== 'string') {
      throw new Error('Valid invitation token is required');
    }
    if (!isValidUuid(userId)) {
      throw new Error('Valid userId is required');
    }

    const tokenHash = hashToken(token);

    return withTransaction(async (client) => {
      const selectSql = `
        SELECT * FROM workspace_invitations
        WHERE token_hash = $1
        FOR UPDATE;
      `;
      const { rows } = await client.query(selectSql, [tokenHash]);
      const invite = rows[0];

      if (!invite) {
        throw new Error('Invitation is invalid or does not exist');
      }

      if (invite.status !== 'pending') {
        throw new Error(`Invitation has already been ${invite.status}`);
      }

      if (new Date(invite.expires_at) <= new Date()) {
        await client.query(
          "UPDATE workspace_invitations SET status = 'expired' WHERE id = $1",
          [invite.id]
        );
        throw new Error('Invitation has expired');
      }

      // Add user to workspace members
      await membershipRepository.addMember(
        {
          workspaceId: invite.workspace_id,
          userId,
          role: invite.role,
          status: 'active',
          invitedBy: invite.invited_by
        },
        client
      );

      // Mark invitation accepted
      const updateSql = `
        UPDATE workspace_invitations
        SET status = 'accepted', accepted_at = NOW()
        WHERE id = $1
        RETURNING id, workspace_id, role, status, accepted_at;
      `;
      const { rows: updatedRows } = await client.query(updateSql, [invite.id]);
      return updatedRows[0];
    });
  }
}

module.exports = new InvitationRepository();
