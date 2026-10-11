import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';

export function attachCompanionControl(server, { apiKey, allowedOrigins = [], timeoutMs = 3000 }) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  let browser = null;
  const pending = new Map();
  const requests = new Map();
  let windowStart = Date.now();
  let requestCount = 0;
  const authenticated = (value) => typeof value === 'string' && value.length <= 512 &&
    Buffer.byteLength(value) === Buffer.byteLength(apiKey) && timingSafeEqual(Buffer.from(value), Buffer.from(apiKey));
  const json = (response, status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  const failPending = () => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.resolve({ ok: false, error: 'Browser disconnected.' }); }
    pending.clear();
  };
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of requests) if (now - entry.at > 60000) requests.delete(id);
    if (browser && now - browser.lastHeartbeat > 10000) browser.terminate();
  }, 1000);
  cleanup.unref();

  sockets.on('connection', (socket) => {
    let ready = false;
    const timer = setTimeout(() => socket.close(1008, 'Authentication required'), 3000);
    socket.on('message', (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { socket.close(1008, 'Invalid JSON'); return; }
      if (!message || typeof message !== 'object') { socket.close(1008); return; }
      if (!ready) {
        if (message.type !== 'authenticate' || !authenticated(message.token)) { socket.close(1008, 'Unauthorized'); return; }
        if (browser && browser.readyState === browser.OPEN) { socket.close(1008, 'A controller tab is already connected'); return; }
        clearTimeout(timer);
        ready = true;
        browser = socket;
        socket.lastHeartbeat = Date.now();
        socket.send(JSON.stringify({ type: 'ready' }));
        return;
      }
      if (message.type === 'heartbeat') { socket.lastHeartbeat = Date.now(); return; }
      if (message.type !== 'ack' || typeof message.requestId !== 'string') return;
      const entry = pending.get(message.requestId);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(message.requestId);
      entry.resolve({ ok: message.ok === true, ...(message.ok === true ? {} : { error: typeof message.error === 'string' ? message.error.slice(0, 256) : 'Control rejected.' }) });
    });
    socket.on('close', () => { clearTimeout(timer); if (browser === socket) { browser = null; failPending(); } });
    socket.on('error', () => socket.close());
  });

  const upgrade = (request, socket, head) => {
    if (request.url !== '/control-ws') return;
    if (!allowedOrigins.includes(request.headers.origin)) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, (connection) => sockets.emit('connection', connection, request));
  };
  server.on('upgrade', upgrade);

  const handle = async (request, response) => {
    if (request.url !== '/api/control' && request.url !== '/api/control/status') return false;
    if (!authenticated(request.headers['x-api-key'])) { json(response, 401, { error: 'Unauthorized.' }); return true; }
    if (request.url === '/api/control/status' && request.method === 'GET') {
      json(response, 200, { connected: Boolean(browser && browser.readyState === browser.OPEN) });
      return true;
    }
    if (request.url !== '/api/control' || request.method !== 'POST') { json(response, 405, { error: 'Method not allowed.' }); return true; }
    if (Date.now() - windowStart >= 1000) { windowStart = Date.now(); requestCount = 0; }
    if (++requestCount > 60) { json(response, 429, { error: 'Control rate limit exceeded.' }); return true; }
    let body = '';
    try {
      for await (const chunk of request) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 4096) { json(response, 413, { error: 'Request too large.' }); return true; }
      }
      const input = JSON.parse(body);
      if (!input || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.mappingId) || typeof input.mappingId !== 'string' ||
        typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.requestId) ||
        !input.event || !['press', 'release', 'value'].includes(input.event.type) ||
        input.event.type === 'value' && (!Number.isFinite(input.event.value) || input.event.value < 0 || input.event.value > 1)) {
        json(response, 400, { error: 'Expected mappingId, unique requestId, and press/release/value event.' }); return true;
      }
      const event = input.event.type === 'value' ? { type: 'value', value: input.event.value } : { type: input.event.type };
      const signature = JSON.stringify({ mappingId: input.mappingId, event });
      const previous = requests.get(input.requestId);
      if (previous) {
        if (previous.signature !== signature) { json(response, 409, { error: 'Request ID reused for a different command.' }); return true; }
        const result = await previous.promise;
        json(response, result.ok ? 200 : 422, result);
        return true;
      }
      if (!browser || browser.readyState !== browser.OPEN) { json(response, 503, { error: 'No authenticated controller tab connected.' }); return true; }
      if (pending.size >= 128 || requests.size >= 2048) { json(response, 429, { error: 'Control queue is full.' }); return true; }
      const promise = new Promise((resolve) => {
        const timer = setTimeout(() => { pending.delete(input.requestId); resolve({ ok: false, error: 'Browser acknowledgement timed out; do not retry with a new request ID.' }); }, timeoutMs);
        pending.set(input.requestId, { resolve, timer });
        browser.send(JSON.stringify({ type: 'control', requestId: input.requestId, mappingId: input.mappingId, event }));
      });
      requests.set(input.requestId, { signature, promise, at: Date.now() });
      const result = await promise;
      json(response, result.ok ? 200 : 422, result);
    } catch { if (!response.headersSent) json(response, 400, { error: 'Invalid request.' }); }
    return true;
  };
  return { handle, close: () => { clearInterval(cleanup); server.off('upgrade', upgrade); sockets.clients.forEach((socket) => socket.terminate()); sockets.close(); failPending(); } };
}