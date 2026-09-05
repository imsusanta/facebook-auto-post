const context = require('../security/context');
const { redact } = require('../security/secrets');
const auth = require('../security/auth');
const clients = new Map();
const bus = require('../services/event-bus');
async function handleSSEConnection(req, res) {
  const id = context.current().workspaceId,
    set = clients.get(id) || new Set();
  if (set.size >= 20)
    return res.status(429).json({ error: 'Too many live connections' });
  res.sessionHash = req.user.token_hash;
  res.userId = req.user.id;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive'
  });
  res.write('event: connected\ndata: {"status":"connected"}\n\n');
  set.add(res);
  clients.set(id, set);
  const clean = () => {
    clearInterval(timer);
    set.delete(res);
    if (!set.size) clients.delete(id);
  };
  let checking = false;
  const timer = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      const session = await auth.session(req);
      if (!session || session.workspace_id !== id) {
        res.end();
        clean();
        return;
      }
      res.write(': heartbeat\n\n');
    } catch {
      res.end();
      clean();
    } finally {
      checking = false;
    }
  }, 10000);
  req.on('close', clean);
}
function deliver(message) {
  if (message.kind === 'resync') {
    for (const workspaceId of clients.keys())
      deliver({
        kind: 'event',
        workspaceId,
        event: 'state_invalidated',
        data: { reason: 'broker_reconnected' }
      });
    return;
  }
  if (message.kind === 'revoke_session') {
    for (const set of clients.values())
      for (const res of set) if (res.sessionHash === message.hash) res.end();
    return;
  }
  if (message.kind === 'revoke_user') {
    for (const set of clients.values())
      for (const res of set) if (res.userId === message.userId) res.end();
    return;
  }
  const payload = `event: ${message.event}\ndata: ${JSON.stringify(redact(message.data))}\n\n`;
  for (const res of clients.get(message.workspaceId) || []) {
    if (res.destroyed || res.writableEnded) continue;
    if (res.writableLength > 1024 * 1024) {
      res.end();
      continue;
    }
    res.write(payload);
  }
}
bus.subscribe(deliver);
function broadcastSSE(event, data) {
  if (!/^[a-z_]{1,64}$/.test(event)) throw new Error('Invalid event name');
  return bus.publish({
    kind: 'event',
    workspaceId: context.current().workspaceId,
    event,
    data: redact(data)
  });
}
function closeAll() {
  for (const set of clients.values()) for (const res of set) res.end();
  clients.clear();
}
function revokeSession(hash) {
  return bus.publish({ kind: 'revoke_session', hash });
}
function revokeUser(userId) {
  return bus.publish({ kind: 'revoke_user', userId });
}
module.exports = {
  handleSSEConnection,
  broadcastSSE,
  closeAll,
  revokeSession,
  revokeUser
};
