/**
 * Server-Sent Events (SSE) Hub
 * Manages real-time client subscriptions and event broadcasting with automatic secret redaction.
 * Enforces central CORS policy without wildcards.
 */

const { serializePublic } = require('../utils/public-serializer');
const { isOriginAllowed } = require('../utils/cors-validator');

const sseClients = new Set();

/**
 * Handle new SSE client connection
 */
function handleSSEConnection(req, res) {
  const headers = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  };

  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers['Vary'] = 'Origin';
  }

  res.writeHead(200, headers);
  res.write('event: connected\ndata: {"status":"connected"}\n\n');
  sseClients.add(res);

  // Keep-alive heartbeat every 25 seconds
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
}

/**
 * Broadcast an event to all connected SSE clients (payload sanitized)
 */
function broadcastSSE(event, data) {
  const sanitizedData = serializePublic(data);
  const payload = `event: ${event}\ndata: ${JSON.stringify(sanitizedData)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

module.exports = {
  handleSSEConnection,
  broadcastSSE,
  getConnectedClientsCount: () => sseClients.size
};
