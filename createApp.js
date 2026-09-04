/**
 * Express Application Factory
 * Configures security middleware, body parsers, routes, and error handling
 * without auto-listening, enabling clean programmatic testing.
 */

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { UPLOADS_DIR } = require('./config/constants');
const errorHandler = require('./middleware/errorHandler');
const apiRoutes = require('./routes');
const { isOriginAllowed } = require('./utils/cors-validator');

function createApp() {
  const app = express();

  // Security Headers via Helmet with self-hosted offline CSP directives
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
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
      if (!origin) return callback(null, true);
      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }
      const err = new Error('Blocked by CORS policy: Origin not allowed.');
      err.statusCode = 403;
      err.code = 'FORBIDDEN_ORIGIN';
      return callback(err);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key', 'X-CSRF-Token', 'x-csrf-token']
  };
  app.use(cors(corsOptions));

  // 1. Dedicated Raw Body Parser for Webhooks (Mounted BEFORE general express.json)
  // Guarantees exact byte-level HMAC-SHA256 signature verification and safe JSON parsing
  app.use('/api/webhook', express.raw({
    type: '*/*',
    limit: '2mb'
  }));
  app.use('/api/webhook', (req, res, next) => {
    if (Buffer.isBuffer(req.body)) {
      req.rawBody = req.body;
      try {
        req.body = JSON.parse(req.body.toString('utf8'));
      } catch {
        // Safe handling: keep req.rawBody for signature verification, safe empty object fallback
        req.body = {};
      }
    } else {
      req.rawBody = Buffer.from('');
    }
    next();
  });

  // 2. General Body Parsers for Non-Webhook API Routes
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Rate Limiting
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, please try again later.' }
  });

  const generateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
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

  return app;
}

const app = createApp();

module.exports = { createApp, app };
