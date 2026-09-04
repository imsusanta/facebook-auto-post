/**
 * AutoPost - Facebook Automation SaaS Engine
 * Entrypoint & Server Bootstrap
 */

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { PORT, NODE_ENV } = require('./config/env');
const { UPLOADS_DIR } = require('./config/constants');
const { broadcastSSE } = require('./middleware/sse');
const errorHandler = require('./middleware/errorHandler');
const apiRoutes = require('./routes');
const scheduler = require('./services/scheduler');
const logger = require('./utils/logger');

const { isOriginAllowed } = require('./utils/cors-validator');

const app = express();

// Security Headers via Helmet with explicit CSP directives
// Note: 'unsafe-inline' for scripts/styles is narrowly retained due to Tailwind CDN and inline config
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.tailwindcss.com", "https://unpkg.com", "'unsafe-inline'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// CORS Configuration with strict origin controls
const corsOptions = {
  origin: (origin, callback) => {
    // Allow server-to-server, curl, same-origin (missing origin header)
    if (!origin) return callback(null, true);
    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Blocked by CORS policy: Origin not allowed.'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key']
};
app.use(cors(corsOptions));

// Safe Request Body Size Limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // 500 requests per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' }
});

const generateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 generation requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Generation rate limit reached. Please slow down.' }
});

app.use('/api', apiLimiter);
app.use('/api/ai/generate', generateLimiter);

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
  logger.info('=======================================================');
  logger.info(`🚀 AutoPost Facebook Automation SaaS Engine`);
  logger.info(`🌐 Environment: ${NODE_ENV}`);
  logger.info(`📡 Local URL:   http://localhost:${PORT}`);
  logger.info('=======================================================');
});

module.exports = { app, server };
