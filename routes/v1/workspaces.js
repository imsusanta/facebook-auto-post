'use strict';

const express = require('express');
const router = express.Router();
const workspaceRepository = require('../../repositories/workspace-repository');
const membershipRepository = require('../../repositories/membership-repository');
const { resolveWorkspaceContext, requireWorkspacePermission, generateRequestId } = require('../../middleware/workspace-context');

// --- Global Workspace Endpoints (Authenticated User Scope) ---

router.post('/', async (req, res) => {
  const requestId = req.headers['x-request-id'] || generateRequestId();
  const user = req.user;

  if (!user || !user.id) {
    return res.status(401).json({
      error: 'AuthRequired',
      message: 'Authentication required to create a workspace.',
      code: 'AUTH_REQUIRED',
      requestId
    });
  }

  const { name, slug } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({
      error: 'ValidationFailed',
      message: 'Workspace name is required.',
      code: 'VALIDATION_FAILED',
      requestId
    });
  }

  try {
    const workspace = await workspaceRepository.createWorkspaceWithOwner({
      name: name.trim(),
      slug: slug ? slug.trim() : name.trim(),
      creatorUserId: user.id
    });

    return res.status(201).json({
      success: true,
      workspace,
      requestId
    });
  } catch (err) {
    if (err.code === '23505') { // PostgreSQL unique violation (e.g. slug)
      return res.status(409).json({
        error: 'SlugConflict',
        message: 'A workspace with this slug already exists. Please select a unique name or slug.',
        code: 'VALIDATION_FAILED',
        requestId
      });
    }
    console.error(`[WorkspacesAPI] Error creating workspace (req ${requestId}):`, err.message);
    return res.status(500).json({
      error: 'InternalError',
      message: 'Failed to create workspace.',
      code: 'DATABASE_UNAVAILABLE',
      requestId
    });
  }
});

router.get('/', async (req, res) => {
  const requestId = req.headers['x-request-id'] || generateRequestId();
  const user = req.user;

  if (!user || !user.id) {
    return res.status(401).json({
      error: 'AuthRequired',
      message: 'Authentication required.',
      code: 'AUTH_REQUIRED',
      requestId
    });
  }

  try {
    const workspaces = await workspaceRepository.listForUser({ userId: user.id });
    return res.status(200).json({
      success: true,
      workspaces,
      requestId
    });
  } catch (err) {
    console.error(`[WorkspacesAPI] Error listing workspaces (req ${requestId}):`, err.message);
    return res.status(503).json({
      error: 'DatabaseUnavailable',
      message: 'Failed to retrieve workspaces.',
      code: 'DATABASE_UNAVAILABLE',
      requestId
    });
  }
});

// --- URL-Scoped Workspace Endpoints ---

router.get(
  '/:workspaceId',
  resolveWorkspaceContext,
  requireWorkspacePermission('workspace:read'),
  async (req, res) => {
    const { workspaceId } = req.params;
    const user = req.user;

    const workspace = await workspaceRepository.getByIdForUser({
      workspaceId,
      userId: user.id
    });

    if (!workspace) {
      return res.status(404).json({
        error: 'WorkspaceNotFound',
        message: 'Workspace not found or access denied.',
        code: 'WORKSPACE_NOT_FOUND',
        requestId: req.requestId
      });
    }

    return res.status(200).json({
      success: true,
      workspace,
      role: req.workspaceContext.role,
      requestId: req.requestId
    });
  }
);

router.patch(
  '/:workspaceId',
  resolveWorkspaceContext,
  requireWorkspacePermission('workspace:update'),
  async (req, res) => {
    const { workspaceId } = req.params;
    const { name, slug } = req.body || {};

    if (!name && !slug) {
      return res.status(400).json({
        error: 'ValidationFailed',
        message: 'At least one field (name, slug) must be provided for update.',
        code: 'VALIDATION_FAILED',
        requestId: req.requestId
      });
    }

    try {
      const updated = await workspaceRepository.update({
        workspaceId,
        updates: { name, slug }
      });

      return res.status(200).json({
        success: true,
        workspace: updated,
        requestId: req.requestId
      });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({
          error: 'SlugConflict',
          message: 'A workspace with this slug already exists.',
          code: 'VALIDATION_FAILED',
          requestId: req.requestId
        });
      }
      return res.status(500).json({
        error: 'InternalError',
        message: err.message || 'Failed to update workspace.',
        code: 'DATABASE_UNAVAILABLE',
        requestId: req.requestId
      });
    }
  }
);

// --- Workspace Membership Endpoints ---

router.get(
  '/:workspaceId/members',
  resolveWorkspaceContext,
  requireWorkspacePermission('members:list'),
  async (req, res) => {
    const { workspaceId } = req.params;
    try {
      const members = await membershipRepository.listMembers({ workspaceId });
      return res.status(200).json({
        success: true,
        members,
        requestId: req.requestId
      });
    } catch (err) {
      console.error(`[MembersAPI] Error listing members (req ${req.requestId}):`, err.message);
      return res.status(503).json({
        error: 'DatabaseUnavailable',
        message: 'Failed to retrieve workspace members.',
        code: 'DATABASE_UNAVAILABLE',
        requestId: req.requestId
      });
    }
  }
);

router.patch(
  '/:workspaceId/members/:userId/role',
  resolveWorkspaceContext,
  requireWorkspacePermission('members:update_role'),
  async (req, res) => {
    const { workspaceId, userId: targetUserId } = req.params;
    const { role: newRole } = req.body || {};

    if (!newRole || typeof newRole !== 'string') {
      return res.status(400).json({
        error: 'ValidationFailed',
        message: 'New role must be specified.',
        code: 'VALIDATION_FAILED',
        requestId: req.requestId
      });
    }

    try {
      const updated = await membershipRepository.updateRole({
        workspaceId,
        targetUserId,
        newRole,
        actorUserId: req.user.id,
        actorRole: req.workspaceContext.role
      });

      return res.status(200).json({
        success: true,
        member: updated,
        requestId: req.requestId
      });
    } catch (err) {
      return res.status(403).json({
        error: 'RoleUpdateDenied',
        message: err.message,
        code: 'PERMISSION_DENIED',
        requestId: req.requestId
      });
    }
  }
);

router.delete(
  '/:workspaceId/members/:userId',
  resolveWorkspaceContext,
  requireWorkspacePermission('members:remove'),
  async (req, res) => {
    const { workspaceId, userId: targetUserId } = req.params;

    try {
      await membershipRepository.removeMember({
        workspaceId,
        targetUserId,
        actorUserId: req.user.id,
        actorRole: req.workspaceContext.role
      });

      return res.status(200).json({
        success: true,
        message: 'Member successfully removed from workspace.',
        requestId: req.requestId
      });
    } catch (err) {
      return res.status(403).json({
        error: 'MemberRemovalDenied',
        message: err.message,
        code: 'PERMISSION_DENIED',
        requestId: req.requestId
      });
    }
  }
);

module.exports = router;
