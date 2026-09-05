const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth');

const systemRoutes = require('./system.routes');
const aiRoutes = require('./ai.routes');
const automationRoutes = require('./automation.routes');
const facebookRoutes = require('./facebook.routes');
const queueRoutes = require('./queue.routes');
const mediaRoutes = require('./media.routes');
const settingsRoutes = require('./settings.routes');
const webhooksRoutes = require('./webhooks.routes');
const templatesRoutes = require('./templates.routes');

// Mount Webhook route first (Meta handles its own challenge and verification)
router.use('/webhook', webhooksRoutes);

// Mount Auth routes (Login, logout, session check)
const authRoutes = require('./auth.routes');
router.use('/auth', authRoutes);

// Apply API authentication middleware to all subsequent routes
router.use(authMiddleware);

// SaaS Phase 1: Multi-Tenant Workspace Routes (Scoped to Authenticated User)
const v1WorkspacesRoutes = require('./v1/workspaces');
router.use('/v1/workspaces', v1WorkspacesRoutes);

// Legacy Operator / Admin Routes: Guarded against ordinary SaaS tenant users
const adminOnly = requireRole(['admin', 'super_admin']);

router.use('/ai', adminOnly, aiRoutes);
router.use('/automation', adminOnly, automationRoutes);
router.use('/facebook', adminOnly, facebookRoutes);
router.use('/queue', adminOnly, queueRoutes);
router.use('/media', adminOnly, mediaRoutes);
router.use('/settings', adminOnly, settingsRoutes);
router.use('/templates', adminOnly, templatesRoutes);

// Legacy root-mounted operator routes (/status, /stats, /history, /events, /post)
router.use('/', adminOnly, systemRoutes);
router.use('/', adminOnly, facebookRoutes);

module.exports = router;
