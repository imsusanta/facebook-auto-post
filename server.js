/**
 * AutoPost - Facebook Automation SaaS Engine
 * Entrypoint & Server Bootstrap
 */

const { PORT, NODE_ENV } = require('./config/env');
const { broadcastSSE } = require('./middleware/sse');
const scheduler = require('./services/scheduler');
const logger = require('./utils/logger');
const { app } = require('./createApp');

// Wire Scheduler Lifecycle Events to SSE Real-time Feed
scheduler.on('status', status => broadcastSSE('scheduler_status', status));
scheduler.on('post_success', data => broadcastSSE('post_success', data));
scheduler.on('post_failed', data => broadcastSSE('post_failed', data));
scheduler.on('queue_updated', queue => broadcastSSE('queue_updated', queue));
scheduler.on('history_updated', history => broadcastSSE('history_updated', history));
scheduler.on('autopilot_generating', data => broadcastSSE('autopilot_generating', data));

let server = null;

// Initialize Background Automation Scheduler & HTTP Listen (only if not running under tests)
if (process.env.NODE_ENV !== 'test') {
  scheduler.init();

  server = app.listen(PORT, () => {
    logger.info('=======================================================');
    logger.info(`🚀 AutoPost Facebook Automation SaaS Engine`);
    logger.info(`🌐 Environment: ${NODE_ENV}`);
    logger.info(`📡 Local URL:   http://localhost:${PORT}`);
    logger.info('=======================================================');
  });
}

module.exports = { app, server, scheduler };
