'use strict';

const express = require('express');
const router = express.Router();
const workspaceRepository = require('../../repositories/workspace-repository');
const membershipRepository = require('../../repositories/membership-repository');
const invitationRepository = require('../../repositories/invitation-repository');
const auditLogRepository = require('../../repositories/audit-log-repository');
const tenantPageRepository = require('../../repositories/tenant-page-repository');
const tenantPostRepository = require('../../repositories/tenant-post-repository');
const tenantScheduleRepository = require('../../repositories/tenant-schedule-repository');
const tenantTemplateRepository = require('../../repositories/tenant-template-repository');
const tenantSettingsRepository = require('../../repositories/tenant-settings-repository');
const tenantMediaRepository = require('../../repositories/tenant-media-repository');
const { publicError } = require('../../security/public-error');
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
    Promise.resolve().then(() => fn(req, res, next)).catch(next);
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
  const requestId = req.requestId || resolveSafeRequestId();
  const { status, ...body } = require('../../security/public-error').publicResponse(err);
  if (status >= 500) require('../../utils/safe-diagnostics')('workspace.route', err, requestId);
  res.setHeader('x-request-id', requestId);
  return res.status(status).json({ ...body, requestId });
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

// --- Tenant Domain Endpoints ---

// Connected Facebook Pages
router.get(
  '/:workspaceId/pages',
  resolveWorkspaceContext,
  requireWorkspacePermission('pages:read'),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    try {
      const pages = await tenantPageRepository.listPages({ workspaceId });
      return res.status(200).json({
        success: true,
        pages,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

router.post(
  '/:workspaceId/pages',
  resolveWorkspaceContext,
  requireWorkspacePermission('pages:manage'),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const { pageId, pageName, accessToken, category, systemPrompt, isDefault } = req.body || {};
    try {
      const page = await tenantPageRepository.connectPage({
        workspaceId,
        pageId,
        pageName,
        accessToken,
        category,
        systemPrompt,
        isDefault,
        actorUserId: req.user.id,
        requestId: req.requestId
      });
      return res.status(201).json({
        success: true,
        page,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

router.get(
  '/:workspaceId/pages/:pageId',
  resolveWorkspaceContext,
  requireWorkspacePermission('pages:read'),
  asyncHandler(async (req, res) => {
    const { workspaceId, pageId } = req.params;
    try {
      const page = await tenantPageRepository.getPageById({ workspaceId, pageId });
      if (!page) {
        throw publicError('RESOURCE_NOT_FOUND', 'Page not found in workspace.');
      }
      return res.status(200).json({
        success: true,
        page,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

router.delete(
  '/:workspaceId/pages/:pageId',
  resolveWorkspaceContext,
  requireWorkspacePermission('pages:manage'),
  asyncHandler(async (req, res) => {
    const { workspaceId, pageId } = req.params;
    try {
      const page = await tenantPageRepository.disconnectPage({
        workspaceId,
        pageId,
        actorUserId: req.user.id,
        requestId: req.requestId
      });
      return res.status(200).json({
        success: true,
        page,
        message: 'Page disconnected successfully.',
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

router.patch(
  '/:workspaceId/pages/:pageId/default',
  resolveWorkspaceContext,
  requireWorkspacePermission('pages:manage'),
  asyncHandler(async (req, res) => {
    const { workspaceId, pageId } = req.params;
    try {
      const page = await tenantPageRepository.setDefaultPage({
        workspaceId,
        pageId,
        actorUserId: req.user.id,
        requestId: req.requestId
      });
      return res.status(200).json({
        success: true,
        page,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

// Posts and Version History
router.get(
  '/:workspaceId/posts',
  resolveWorkspaceContext,
  requireWorkspacePermission('drafts:read'),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const { status, limit, offset } = req.query || {};
    try {
      const posts = await tenantPostRepository.listPosts({
        workspaceId,
        status,
        limit,
        offset
      });
      return res.status(200).json({
        success: true,
        posts,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

router.post(
  '/:workspaceId/posts',
  resolveWorkspaceContext,
  requireWorkspacePermission('drafts:create'),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const { caption, category, topic, mediaUrls, pageId, status, scheduledAt } = req.body || {};
    try {
      const post = await tenantPostRepository.createPost({
        workspaceId,
        createdBy: req.user.id,
        caption,
        category,
        topic,
        mediaUrls,
        pageId,
        status: status || 'draft',
        scheduledAt,
        requestId: req.requestId
      });
      return res.status(201).json({
        success: true,
        post,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

router.get(
  '/:workspaceId/posts/:postId',
  resolveWorkspaceContext,
  requireWorkspacePermission('drafts:read'),
  asyncHandler(async (req, res) => {
    const { workspaceId, postId } = req.params;
    try {
      const post = await tenantPostRepository.getPostById({ workspaceId, postId });
      if (!post) {
        throw publicError('RESOURCE_NOT_FOUND', 'Post not found in workspace.');
      }
      return res.status(200).json({
        success: true,
        post,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

router.patch(
  '/:workspaceId/posts/:postId',
  resolveWorkspaceContext,
  requireWorkspacePermission('drafts:update'),
  asyncHandler(async (req, res) => {
    const { workspaceId, postId } = req.params;
    const updates = req.body || {};
    try {
      const post = await tenantPostRepository.updatePost({
        workspaceId,
        postId,
        updates,
        actorUserId: req.user.id,
        requestId: req.requestId
      });
      return res.status(200).json({
        success: true,
        post,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

router.delete(
  '/:workspaceId/posts/:postId',
  resolveWorkspaceContext,
  requireWorkspacePermission('drafts:delete'),
  asyncHandler(async (req, res) => {
    const { workspaceId, postId } = req.params;
    try {
      await tenantPostRepository.deletePost({
        workspaceId,
        postId,
        actorUserId: req.user.id,
        requestId: req.requestId
      });
      return res.status(200).json({
        success: true,
        message: 'Post deleted successfully.',
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

router.get(
  '/:workspaceId/posts/:postId/versions',
  resolveWorkspaceContext,
  requireWorkspacePermission('drafts:read'),
  asyncHandler(async (req, res) => {
    const { workspaceId, postId } = req.params;
    try {
      const post = await tenantPostRepository.getPostById({ workspaceId, postId });
      if (!post) {
        throw publicError('RESOURCE_NOT_FOUND', 'Post not found in workspace.');
      }
      const versions = await tenantPostRepository.getPostVersions({ workspaceId, postId });
      return res.status(200).json({
        success: true,
        versions,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

// Schedules
router.get(
  '/:workspaceId/schedules',
  resolveWorkspaceContext,
  requireWorkspacePermission('schedule:read'),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    try {
      const schedule = await tenantScheduleRepository.getSchedule({ workspaceId });
      return res.status(200).json({
        success: true,
        schedule,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

router.put(
  '/:workspaceId/schedules',
  resolveWorkspaceContext,
  requireWorkspacePermission('schedule:update'),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const { pageId, cronExpression, cronLabel, status, selectedCategories, includeAiImage } = req.body || {};
    try {
      const schedule = await tenantScheduleRepository.saveSchedule({
        workspaceId,
        pageId,
        cronExpression,
        cronLabel,
        status,
        selectedCategories,
        includeAiImage,
        actorUserId: req.user.id,
        requestId: req.requestId
      });
      return res.status(200).json({
        success: true,
        schedule,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

// Templates
router.get(
  '/:workspaceId/templates',
  resolveWorkspaceContext,
  requireWorkspacePermission('templates:read'),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    try {
      const templates = await tenantTemplateRepository.listTemplates({ workspaceId });
      return res.status(200).json({
        success: true,
        templates,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

router.post(
  '/:workspaceId/templates',
  resolveWorkspaceContext,
  requireWorkspacePermission('templates:manage'),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const { slug, title, badge, category, description, sample } = req.body || {};
    try {
      const template = await tenantTemplateRepository.createTemplate({
        workspaceId,
        slug,
        title,
        badge,
        category,
        description,
        sample,
        actorUserId: req.user.id,
        requestId: req.requestId
      });
      return res.status(201).json({
        success: true,
        template,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

router.get(
  '/:workspaceId/templates/:templateId',
  resolveWorkspaceContext,
  requireWorkspacePermission('templates:read'),
  asyncHandler(async (req, res) => {
    const { workspaceId, templateId } = req.params;
    try {
      const template = await tenantTemplateRepository.getTemplateById({ workspaceId, templateId });
      if (!template) {
        throw publicError('RESOURCE_NOT_FOUND', 'Template not found in workspace.');
      }
      return res.status(200).json({
        success: true,
        template,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

router.delete(
  '/:workspaceId/templates/:templateId',
  resolveWorkspaceContext,
  requireWorkspacePermission('templates:manage'),
  asyncHandler(async (req, res) => {
    const { workspaceId, templateId } = req.params;
    try {
      await tenantTemplateRepository.deleteTemplate({
        workspaceId,
        templateId,
        actorUserId: req.user.id,
        requestId: req.requestId
      });
      return res.status(200).json({
        success: true,
        message: 'Template deleted successfully.',
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

// Settings
router.get(
  '/:workspaceId/settings',
  resolveWorkspaceContext,
  requireWorkspacePermission('settings:read'),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    try {
      const settings = await tenantSettingsRepository.getSettings({ workspaceId });
      return res.status(200).json({
        success: true,
        settings,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

router.put(
  '/:workspaceId/settings',
  resolveWorkspaceContext,
  requireWorkspacePermission('settings:update'),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const updates = req.body || {};
    try {
      const settings = await tenantSettingsRepository.updateSettings({
        workspaceId,
        updates,
        actorUserId: req.user.id,
        requestId: req.requestId
      });
      return res.status(200).json({
        success: true,
        settings,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

// Media Assets
router.get(
  '/:workspaceId/media',
  resolveWorkspaceContext,
  requireWorkspacePermission('media:read'),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const { limit, offset } = req.query || {};
    try {
      const media = await tenantMediaRepository.listMedia({ workspaceId, limit, offset });
      return res.status(200).json({
        success: true,
        media,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

router.post(
  '/:workspaceId/media',
  resolveWorkspaceContext,
  requireWorkspacePermission('media:upload'),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const { filename, storagePath, mimeType, sizeBytes } = req.body || {};
    try {
      const media = await tenantMediaRepository.recordMediaUpload({
        workspaceId,
        filename,
        storagePath,
        mimeType,
        sizeBytes,
        actorUserId: req.user.id,
        requestId: req.requestId
      });
      return res.status(201).json({
        success: true,
        media,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

router.delete(
  '/:workspaceId/media/:mediaId',
  resolveWorkspaceContext,
  requireWorkspacePermission('media:delete'),
  asyncHandler(async (req, res) => {
    const { workspaceId, mediaId } = req.params;
    try {
      await tenantMediaRepository.deleteMedia({
        workspaceId,
        mediaId,
        actorUserId: req.user.id,
        requestId: req.requestId
      });
      return res.status(200).json({
        success: true,
        message: 'Media asset deleted successfully.',
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

// --- Facebook / Meta OAuth Integration ---

const facebookOAuth = require('../../services/facebook-oauth');

// GET /:workspaceId/facebook/auth — Initiate OAuth flow
router.get(
  '/:workspaceId/facebook/auth',
  resolveWorkspaceContext,
  requireWorkspacePermission('facebook:connect'),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.workspaceContext;
    try {
      const result = await facebookOAuth.generateAuthUrl({
        workspaceId,
        userId: req.user.id
      });
      return res.status(200).json({
        success: true,
        authUrl: result.authUrl,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

// GET /:workspaceId/facebook/callback — Handle OAuth callback
router.get(
  '/:workspaceId/facebook/callback',
  resolveWorkspaceContext,
  requireWorkspacePermission('facebook:connect'),
  asyncHandler(async (req, res) => {
    const { code, state, error: oauthError } = req.query || {};
    if (oauthError) {
      return res.status(400).json({
        success: false,
        error: 'OAuthDenied',
        message: 'User denied the authorization request.',
        code: 'OAUTH_STATE_INVALID',
        requestId: req.requestId
      });
    }
    try {
      const result = await facebookOAuth.handleCallback({ code, state });
      return res.status(200).json({
        success: true,
        pages: result.pages,
        workspaceId: result.workspaceId,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

// POST /:workspaceId/facebook/connect — Connect selected pages
router.post(
  '/:workspaceId/facebook/connect',
  resolveWorkspaceContext,
  requireWorkspacePermission('facebook:connect'),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.workspaceContext;
    const { selectedPages, longLivedUserToken } = req.body || {};
    try {
      const connected = await facebookOAuth.connectSelectedPages({
        workspaceId,
        userId: req.user.id,
        selectedPages,
        longLivedUserToken,
        requestId: req.requestId
      });
      return res.status(201).json({
        success: true,
        pages: connected,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

// POST /:workspaceId/facebook/disconnect/:pageId — Disconnect a page
router.post(
  '/:workspaceId/facebook/disconnect/:pageId',
  resolveWorkspaceContext,
  requireWorkspacePermission('facebook:disconnect'),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.workspaceContext;
    const { pageId } = req.params;
    try {
      const result = await facebookOAuth.disconnectPage({
        workspaceId,
        pageId,
        userId: req.user.id,
        requestId: req.requestId
      });
      return res.status(200).json({
        success: true,
        ...result,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

// GET /:workspaceId/facebook/status — Connection status for all pages
router.get(
  '/:workspaceId/facebook/status',
  resolveWorkspaceContext,
  requireWorkspacePermission('facebook:status'),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.workspaceContext;
    try {
      const statuses = await facebookOAuth.getConnectionStatus({ workspaceId });
      return res.status(200).json({
        success: true,
        connections: statuses,
        requestId: req.requestId
      });
    } catch (err) {
      return sendSafeError(res, req, err);
    }
  })
);

// POST /:workspaceId/facebook/test-connection/:pageId — Test Graph API connectivity
router.post(
  '/:workspaceId/facebook/test-connection/:pageId',
  resolveWorkspaceContext,
  requireWorkspacePermission('facebook:status'),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.workspaceContext;
    const { pageId } = req.params;
    try {
      const result = await facebookOAuth.testPageConnection({
        workspaceId,
        pageId
      });
      return res.status(200).json({
        success: true,
        ...result,
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
