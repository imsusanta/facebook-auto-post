const context = require('../security/context');
const { redact } = require('../security/secrets');
const auth = require('../security/auth');
const clients = new Map();
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
function broadcastSSE(event, data) {
  const id = context.current().workspaceId;
  const payload = `event: ${event}\ndata: ${JSON.stringify(redact(data))}\n\n`;
  for (const res of clients.get(id) || [])
    if (!res.destroyed) res.write(payload);
}
function closeAll() {
  for (const set of clients.values()) for (const res of set) res.end();
  clients.clear();
}
function revokeSession(hash) {
  for (const set of clients.values())
    for (const res of set) if (res.sessionHash === hash) res.end();
}
function revokeUser(id) {
  for (const set of clients.values())
    for (const res of set) if (res.userId === id) res.end();
}
module.exports = {
  handleSSEConnection,
  broadcastSSE,
  closeAll,
  revokeSession,
  revokeUser
};
