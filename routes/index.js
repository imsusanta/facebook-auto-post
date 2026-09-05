const express = require('express');
const router = express.Router();

const systemRoutes = require('./system.routes');
const aiRoutes = require('./ai.routes');
const automationRoutes = require('./automation.routes');
const facebookRoutes = require('./facebook.routes');
const queueRoutes = require('./queue.routes');
const mediaRoutes = require('./media.routes');
const settingsRoutes = require('./settings.routes');

const templatesRoutes = require('./templates.routes');

router.use('/workspace', require('./workspace.routes'));

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
