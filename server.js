const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const config = require('./config/env');
const db = require('./services/db');
const auth = require('./security/auth');
const limit = require('./security/rate-limit');
const { redact } = require('./security/secrets');
const { validate } = require('./security/validation');
function createApp() {
  config.validate();
  const app = express();
  app.disable('x-powered-by');
  // Explicit trusted proxy CIDRs only; never blindly trust arbitrary forwarding headers.
  if (process.env.TRUST_PROXY)
    app.set(
      'trust proxy',
      process.env.TRUST_PROXY.split(',').map((s) => s.trim())
    );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'https:', 'data:', 'blob:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.production ? [] : null
        }
      },
      referrerPolicy: { policy: 'no-referrer' }
    })
  );
  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
  app.get('/readyz', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await require('./scripts/migrate').assertCurrent();
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'not_ready' });
    }
  });
  app.use(
    '/api/webhook',
    limit('webhook-ip', 300, 60),
    express.raw({ type: 'application/json', limit: '256kb' }),
    require('./routes/webhooks.routes')
  );
  app.use(express.json({ limit: '128kb' }));
  app.use(
    express.urlencoded({ extended: false, limit: '32kb', parameterLimit: 30 })
  );
  app.use(
    '/api',
    (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      next();
    },
    auth.sameOrigin
  );
  app.use('/api/auth', require('./routes/auth.routes'));
  app.use(
    '/api',
    auth.authenticate,
    auth.authorize,
    limit('workspace-api', 300, 60, (req) => req.user.workspace_id)
  );
  const aiLimit = limit(
    'workspace-ai',
    20,
    3600,
    (req) => req.user.workspace_id
  );
  app.use('/api/ai', (req, res, next) =>
    req.method === 'GET' ? next() : aiLimit(req, res, next)
  );
  app.use(
    '/api/automation',
    limit('workspace-bot', 40, 3600, (req) => req.user.workspace_id)
  );
  app.use(
    '/api/media',
    limit('workspace-media', 60, 3600, (req) => req.user.workspace_id)
  );
  app.use(
    '/api',
    (req, res, next) => {
      const json = res.json.bind(res);
      res.json = (data) => json(redact(data));
      next();
    },
    validate,
    require('./routes')
  );
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  app.get('/uploads/:file', auth.authenticate, async (req, res) => {
    const filename = await require('./security/media').resolve(
      '/uploads/' + req.params.file
    );
    res.set({
      'Cache-Control': 'private, no-store',
      'Content-Type': 'image/jpeg'
    });
    res.sendFile(filename);
  });
  app.get('/vendor/dompurify.js', (req, res) =>
    res.sendFile(require.resolve('dompurify/dist/purify.min.js'))
  );
  app.get('/vendor/lucide.js', (req, res) =>
    res.sendFile(
      path.join(
        __dirname,
        'node_modules',
        'lucide',
        'dist',
        'umd',
        'lucide.min.js'
      )
    )
  );
  app.get(['/', '/index.html'], async (req, res) => {
    const user = await auth.session(req);
    if (!user?.email_verified_at) return res.redirect('/auth.html');
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
  app.use(
    express.static(path.join(__dirname, 'public'), {
      index: false,
      dotfiles: 'deny'
    })
  );
  app.use(require('./middleware/errorHandler'));
  return app;
}
async function start() {
  const app = createApp();
  await require('./scripts/migrate').assertCurrent();
  await require('./services/event-bus').start();
  await require('./services/scheduler').init();
  require('./services/webhook-worker').start();
  const cleanup = setInterval(
    () =>
      db
        .query(
          'DELETE FROM sessions WHERE expires_at<now(); DELETE FROM auth_tokens WHERE expires_at<now(); DELETE FROM rate_limits WHERE expires_at<now()'
        )
        .catch(() => console.warn('[Cleanup] Failed')),
    3600000
  );
  cleanup.unref();
  const server = app.listen(config.PORT, () => console.log('AutoPost started'));
  async function shutdown() {
    clearInterval(cleanup);
    require('./services/webhook-worker').stop();
    require('./middleware/sse').closeAll();
    await require('./services/event-bus').stop();
    await require('./services/scheduler').shutdown();
    server.close(async () => {
      await db.pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  }
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return { app, server };
}
if (require.main === module)
  start().catch(() => {
    console.error(
      'Startup failed. Check environment, migrations, and database connectivity.'
    );
    process.exit(1);
  });
module.exports = { createApp, start };
