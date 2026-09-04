/**
 * AutoPost - Facebook Automation SaaS Engine
 * Entrypoint & Server Bootstrap
 */

const path = require('path');
const express = require('express');
const cors = require('cors');

const { PORT, NODE_ENV } = require('./config/env');
const { UPLOADS_DIR } = require('./config/constants');
const { broadcastSSE } = require('./middleware/sse');
const errorHandler = require('./middleware/errorHandler');
const apiRoutes = require('./routes');
const scheduler = require('./services/scheduler');

const app = express();

// Standard SaaS Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets & uploaded media
app.use('/uploads', express.static(path.join(__dirname, UPLOADS_DIR)));
app.use(express.static(path.join(__dirname, 'public')));

// Mount Master API Router
app.use('/api', apiRoutes);

// Centralized Error Handler
app.use(errorHandler);

// Wire Scheduler Lifecycle Events to SSE Real-time Feed
scheduler.on('status', status => broadcastSSE('scheduler_status', status));
scheduler.on('post_success', data => broadcastSSE('post_success', data));
scheduler.on('post_failed', data => broadcastSSE('post_failed', data));
scheduler.on('queue_updated', queue => broadcastSSE('queue_updated', queue));
scheduler.on('history_updated', history => broadcastSSE('history_updated', history));
scheduler.on('autopilot_generating', data => broadcastSSE('autopilot_generating', data));

// Initialize Background Automation Scheduler
scheduler.init();

// Boot HTTP Server
const server = app.listen(PORT, () => {
  console.log('=======================================================');
  console.log(`🚀 AutoPost Facebook Automation SaaS Engine`);
  console.log(`🌐 Environment: ${NODE_ENV}`);
  console.log(`📡 Local URL:   http://localhost:${PORT}`);
  console.log('=======================================================');
});

module.exports = { app, server };
