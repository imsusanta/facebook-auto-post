// Run separately from the web process on an always-on host; no HTTP listener.
const config = require('./config/env');
const db = require('./services/db');
async function start() {
  config.validate();
  if (!config.ENABLE_AUTOMATION)
    throw new Error('Worker requires ENABLE_AUTOMATION=true');
  await require('./scripts/migrate').assertCurrent();
  await require('./services/event-bus').start();
  await require('./services/scheduler').init();
  require('./services/webhook-worker').start();
  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => process.exit(1), 40000);
    deadline.unref();
    await require('./services/scheduler').shutdown();
    require('./services/webhook-worker').stop();
    await require('./services/event-bus').stop();
    await db.pool.end();
    clearTimeout(deadline);
    process.exit(0);
  }
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  console.log('Durable publishing worker started');
}
if (require.main === module)
  start().catch(() => {
    console.error('Worker startup failed: check configuration and migrations');
    process.exit(1);
  });
module.exports = { start };
