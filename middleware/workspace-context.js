'use strict';

const crypto = require('crypto');
const { isValidUuid } = require('../db/uuid');
const membershipRepository = require('../repositories/membership-repository');
const { hasPermission } = require('../security/permissions');

const SAFE_REQUEST_ID_REGEX = /^[-_a-zA-Z0-9.]{1,64}$/;

function generateRequestId() {
  return `req_${crypto.randomUUID()}`;
}

function resolveSafeRequestId(headerValue) {
  if (typeof headerValue === 'string') {
    const trimmed = headerValue.trim();
    if (SAFE_REQUEST_ID_REGEX.test(trimmed)) {
      return trimmed;
    }
  }
  return generateRequestId();
}

/**
 * Middleware that validates the workspaceId URL parameter, enforces body anti-tampering,
 * verifies active workspace membership, and binds verified context to req.workspaceContext.
 */
async function resolveWorkspaceContext(req, res, next) {
  const requestId = resolveSafeRequestId(req.headers['x-request-id']);
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  // 1. Anti-Tampering: Prohibit client-supplied workspaceId in request bodies
  if (req.body && (req.body.workspaceId !== undefined || req.body.workspace_id !== undefined)) {
    return res.status(400).json({
      error: 'ValidationFailed',
      message: 'Explicit workspaceId in request body is prohibited. Workspace context must be derived exclusively from URL path.',
      code: 'VALIDATION_FAILED',
      requestId
    });
  }

  // 2. Validate URL workspaceId parameter
  const { workspaceId } = req.params;
  if (!workspaceId || !isValidUuid(workspaceId)) {
    return res.status(400).json({
      error: 'InvalidWorkspaceId',
      message: 'The workspace identifier supplied in the URL path is malformed or invalid.',
      code: 'INVALID_WORKSPACE_ID',
      requestId
    });
  }

  // 3. User Identity Check
  const user = req.user;
  if (!user || !user.id) {
    return res.status(401).json({
      error: 'AuthRequired',
      message: 'Authentication is required to access workspace resources.',
      code: 'AUTH_REQUIRED',
      requestId
    });
  }

  try {
    // 4. Verify active membership in the target workspace
    const membership = await membershipRepository.findActive({
      workspaceId,
      userId: user.id
    });

    if (!membership || membership.status !== 'active') {
      // Return 404 to prevent enumeration of existing foreign workspaces
      return res.status(404).json({
        error: 'WorkspaceNotFound',
        message: 'Workspace not found or access denied.',
        code: 'WORKSPACE_NOT_FOUND',
        requestId
      });
    }

    // 5. Attach verified workspace context
    req.workspaceContext = {
      workspaceId,
      user,
      membership,
      role: membership.role
    };

    next();
  } catch (err) {
    console.error(`[WorkspaceContext] Error resolving membership for req ${requestId}:`, err.message);
    return res.status(503).json({
      error: 'DatabaseUnavailable',
      message: 'Database service is temporarily unavailable. Please retry.',
      code: 'DATABASE_UNAVAILABLE',
      requestId
    });
  }
}

/**
 * Middleware factory requiring a specific RBAC permission within the active workspace context.
 * In production, returns generic error message without leaking internal role/permission metadata.
 * @param {string} permission
 */
function requireWorkspacePermission(permission) {
  return (req, res, next) => {
    const requestId = req.requestId || generateRequestId();

    if (!req.workspaceContext || !req.workspaceContext.role) {
      return res.status(401).json({
        error: 'AuthRequired',
        message: 'Workspace authorization context is missing.',
        code: 'AUTH_REQUIRED',
        requestId
      });
    }

    const { role } = req.workspaceContext;
    if (!hasPermission(role, permission)) {
      const isProduction = process.env.NODE_ENV === 'production';
      return res.status(403).json({
        error: 'PermissionDenied',
        message: isProduction
          ? 'You do not have permission to perform this action.'
          : `Insufficient permissions. Role "${role}" lacks required permission: "${permission}".`,
        code: 'PERMISSION_DENIED',
        ...(!isProduction ? { permission, role } : {}),
        requestId
      });
    }

    next();
  };
}

module.exports = {
  resolveWorkspaceContext,
  requireWorkspacePermission,
  generateRequestId,
  resolveSafeRequestId
};
