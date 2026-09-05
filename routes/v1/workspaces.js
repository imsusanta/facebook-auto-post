'use strict';

const express = require('express');
const router = express.Router();
const workspaceRepository = require('../../repositories/workspace-repository');
const membershipRepository = require('../../repositories/membership-repository');
const invitationRepository = require('../../repositories/invitation-repository');
const auditLogRepository = require('../../repositories/audit-log-repository');
const {
  resolveWorkspaceContext,
  requireWorkspacePermission,
  resolveSafeRequestId
} = require('../../middleware/workspace-context');

/**
 * Wraps async route handlers to pass rejections to Express error middleware.
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Top-level middleware to enforce sanitized, uniform x-request-id across all workspace endpoints.
 */
router.use((req, res, next) => {
  const requestId = resolveSafeRequestId(req.headers['x-request-id']);
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
});

/**
 * Centralized typed error mapper for workspace route responses.
 * Never leaks internal database strings, syntax errors, or credentials.
 */
function sendSafeError(res, req, err) {
  const requestId = req.requestId || resolveSafeRequestId(req.headers['x-request-id']);
  const isProd = process.env.NODE_ENV === 'production';

  // 1. Conflict errors (409)
  if (
    err.code === 'CONFLICT' ||
    err.code === '23505' ||
    err.message?.includes('already exists') ||
    err.message?.includes('already an active member') ||
    err.message?.includes('conflict')
  ) {
    return res.status(409).json({
      error: 'Conflict',
      message: err.message || 'A conflict occurred with an existing resource.',
      code: 'CONFLICT',
      requestId
    });
  }

  // 2. Permission / Role violation errors (403)
  if (
    err.code === 'PERMISSION_DENIED' ||
    err.code === 'FORBIDDEN' ||
    err.message?.includes('permission') ||
    err.message?.includes('Privilege violation') ||
    err.message?.includes('Safety violation') ||
    err.message?.includes('Self-elevation') ||
    err.message?.includes('cannot grant') ||
    err.message?.includes('cannot alter') ||
    err.message?.includes('cannot remove') ||
    err.message?.includes('cannot demote') ||
    err.message?.includes('Suspended members cannot') ||
    err.message?.includes('no longer possesses administrative authority')
  ) {
    return res.status(403).json({
      error: 'PermissionDenied',
      message: isProd ? 'You do not have permission to perform this action.' : err.message,
      code: 'PERMISSION_DENIED',
      requestId
    });
  }

  // 3. Validation errors (400)
  if (
    err.code === 'VALIDATION_FAILED' ||
    err.message?.includes('required') ||
    err.message?.includes('must be') ||
    err.message?.includes('Invalid') ||
    err.message?.includes('malformed') ||
    err.message?.includes('cannot receive invites')
  ) {
    return res.status(400).json({
      error: 'ValidationFailed',
      message: err.message,
      code: 'VALIDATION_FAILED',
      requestId
    });
  }

  // 4. Invitation expired or invalid (400)
  if (
    err.message?.includes('Invitation has expired') ||
    err.message?.includes('Invitation has already been') ||
    err.message?.includes('Invitation is invalid') ||
    err.message?.includes('Email must be verified') ||
    err.message?.includes('does not match this account')
  ) {
    return res.status(400).json({
      error: 'InvitationInvalid',
      message: err.message,
      code: 'INVITATION_INVALID',
      requestId
    });
  }

  // 5. Resource not found / Inaccessible (404)
  if (
    err.message?.includes('not found') ||
    err.message?.includes('inactive') ||
    err.message?.includes('does not exist')
  ) {
    return res.status(404).json({
      error: 'WorkspaceNotFound',
      message: 'Workspace not found or access denied.',
      code: 'WORKSPACE_NOT_FOUND',
      requestId
    });
  }

  // 6. Generic 500 for unexpected errors / database internals
  console.error(`[WorkspacesAPI] Internal error on req ${requestId}:`, isProd ? err.code : err.message);
  return res.status(500).json({
    error: 'InternalError',
    message: 'An unexpected internal error occurred.',
    code: 'INTERNAL_ERROR',
    requestId
  });
}

// --- Global Workspace Endpoints (Authenticated User Scope) ---

router.post('/invitations/accept', asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user || !user.id) {
    return res.status(401).json({
      error: 'AuthRequired',
      message: 'Authentication required to accept an invitation.',
      code: 'AUTH_REQUIRED',
      requestId: req.requestId
    });
  }

  const { token } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({
      error: 'ValidationFailed',
      message: 'Invitation token is required.',
      code: 'VALIDATION_FAILED',
      requestId: req.requestId
    });
  }

  try {
    const membership = await invitationRepository.acceptInvitation({
      token,
      userId: user.id,
      requestId: req.requestId
    });

    return res.status(200).json({
      success: true,
      membership,
      requestId: req.requestId
    });
  } catch (err) {
    return sendSafeError(res, req, err);
  }
}));

router.post('/', asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user || !user.id) {
    return res.status(401).json({
      error: 'AuthRequired',
      message: 'Authentication required to create a workspace.',
      code: 'AUTH_REQUIRED',
      requestId: req.requestId
    });
  }

  const { name, slug } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({
      error: 'ValidationFailed',
      message: 'Workspace name is required.',
      code: 'VALIDATION_FAILED',
      requestId: req.requestId
    });
  }

  try {
    const workspace = await workspaceRepository.createWorkspaceWithOwner({
      name: name.trim(),
      slug: slug ? slug.trim() : name.trim(),
      creatorUserId: user.id,
      requestId: req.requestId
    });

    return res.status(201).json({
      success: true,
      workspace,
      requestId: req.requestId
    });
  } catch (err) {
    return sendSafeError(res, req, err);
  }
}));

router.get('/', asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user || !user.id) {
    return res.status(401).json({
      error: 'AuthRequired',
      message: 'Authentication required.',
      code: 'AUTH_REQUIRED',
      requestId: req.requestId
    });
  }

  try {
    const workspaces = await workspaceRepository.listForUser({ userId: user.id });
    return res.status(200).json({
      success: true,
      workspaces,
      requestId: req.requestId
    });
  } catch (err) {
    return sendSafeError(res, req, err);
  }
}));

// --- URL-Scoped Workspace Endpoints ---

router.get(
  '/:workspaceId',
  resolveWorkspaceContext,
  requireWorkspacePermission('workspace:read'),
  asyncHandler(async (req, res) => {
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
  })
);

router.patch(
  '/:workspaceId',
  resolveWorkspaceContext,
  requireWorkspacePermission('workspace:update'),
  asyncHandler(async (req, res) => {
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
        updates: { name, slug },
        actorUserId: req.user.id,
        requestId: req.requestId
      });

      return res.status(200).json({
        success: true,
        workspace: updated,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

// --- Workspace Membership Endpoints ---

router.get(
  '/:workspaceId/members',
  resolveWorkspaceContext,
  requireWorkspacePermission('members:list'),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    try {
      const members = await membershipRepository.listMembers({ workspaceId });
      return res.status(200).json({
        success: true,
        members,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

router.patch(
  '/:workspaceId/members/:userId/role',
  resolveWorkspaceContext,
  requireWorkspacePermission('members:update_role'),
  asyncHandler(async (req, res) => {
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
        actorRole: req.workspaceContext.role,
        requestId: req.requestId
      });

      return res.status(200).json({
        success: true,
        member: updated,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

router.delete(
  '/:workspaceId/members/:userId',
  resolveWorkspaceContext,
  requireWorkspacePermission('members:remove'),
  asyncHandler(async (req, res) => {
    const { workspaceId, userId: targetUserId } = req.params;

    try {
      await membershipRepository.removeMember({
        workspaceId,
        targetUserId,
        actorUserId: req.user.id,
        actorRole: req.workspaceContext.role,
        requestId: req.requestId
      });

      return res.status(200).json({
        success: true,
        message: 'Member successfully removed from workspace.',
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

// --- Workspace Invitation Endpoints ---

router.post(
  '/:workspaceId/invitations',
  resolveWorkspaceContext,
  requireWorkspacePermission('members:invite'),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const { email, role, ttlHours } = req.body || {};

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({
        error: 'ValidationFailed',
        message: 'A valid email address is required.',
        code: 'VALIDATION_FAILED',
        requestId: req.requestId
      });
    }

    if (!role || typeof role !== 'string') {
      return res.status(400).json({
        error: 'ValidationFailed',
        message: 'A valid role is required.',
        code: 'VALIDATION_FAILED',
        requestId: req.requestId
      });
    }

    if (role === 'owner') {
      return res.status(403).json({
        error: 'InvalidRole',
        message: 'Invitations cannot grant the owner role.',
        code: 'INVALID_ROLE',
        requestId: req.requestId
      });
    }

    try {
      const result = await invitationRepository.createInvitation({
        workspaceId,
        email,
        role,
        invitedBy: req.user.id,
        ttlHours: ttlHours !== undefined ? ttlHours : 72,
        requestId: req.requestId
      });

      return res.status(201).json({
        success: true,
        invitation: result.invitation,
        token: result.token,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

router.get(
  '/:workspaceId/invitations',
  resolveWorkspaceContext,
  requireWorkspacePermission('members:list'),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    try {
      const invitations = await invitationRepository.listByWorkspace({ workspaceId });
      return res.status(200).json({
        success: true,
        invitations,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

router.delete(
  '/:workspaceId/invitations/:invitationId',
  resolveWorkspaceContext,
  requireWorkspacePermission('members:invite'),
  asyncHandler(async (req, res) => {
    const { workspaceId, invitationId } = req.params;
    try {
      const revoked = await invitationRepository.revokeInvitation({
        workspaceId,
        invitationId,
        actorUserId: req.user.id,
        requestId: req.requestId
      });

      return res.status(200).json({
        success: true,
        invitation: revoked,
        message: 'Invitation successfully revoked.',
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

// --- Workspace Audit Logs Endpoint ---

router.get(
  '/:workspaceId/audit-logs',
  resolveWorkspaceContext,
  requireWorkspacePermission('audit:read'),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const { limit, offset, resourceType, action } = req.query || {};

    try {
      const auditLogs = await auditLogRepository.listByWorkspace({
        workspaceId,
        limit,
        offset,
        resourceType,
        action
      });

      return res.status(200).json({
        success: true,
        auditLogs,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

// Fallthrough error handler for unhandled errors
router.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  return sendSafeError(res, req, err);
});

module.exports = router;
