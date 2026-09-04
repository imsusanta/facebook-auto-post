const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');

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

// Mount Domain Routes
router.use('/', systemRoutes);
router.use('/ai', aiRoutes);
router.use('/automation', automationRoutes);
router.use('/facebook', facebookRoutes);
router.use('/', facebookRoutes); // Mounts /post directly under /api/post
router.use('/queue', queueRoutes);
router.use('/media', mediaRoutes);
router.use('/settings', settingsRoutes);
router.use('/templates', templatesRoutes);

module.exports = router;
