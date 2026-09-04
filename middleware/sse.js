/**
 * Server-Sent Events (SSE) Hub
 * Manages real-time client subscriptions and event broadcasting
 */

const sseClients = new Set();

/**
 * Handle new SSE client connection
 */
function handleSSEConnection(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

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
 * Broadcast an event to all connected SSE clients
 */
function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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
