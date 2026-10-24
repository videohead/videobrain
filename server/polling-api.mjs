import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const PORT = Number(process.env.POLLING_PORT ?? 8934);
const HOST = process.env.POLLING_HOST ?? '0.0.0.0';
const API_KEY = process.env.POLLING_API_KEY ?? process.env.CONTROL_API_KEY;
const GRAPH_FILE = process.env.POLLING_GRAPH_FILE ?? join(process.cwd(), 'data', 'polled-graph.json');

if (!API_KEY) {
  console.error('POLLING_API_KEY or CONTROL_API_KEY is required.');
  process.exit(1);
}

let currentGraph = null;
let lastModified = null;
let etag = null;

function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'ETag': etag || '',
    ...headers,
  });
  res.end(payload);
}

function checkAuth(req, res) {
  if (req.headers['x-api-key'] === API_KEY) return true;
  sendJson(res, 401, { error: 'Missing or invalid X-API-Key header.' });
  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function loadGraph() {
  try {
    const content = await readFile(GRAPH_FILE, 'utf8');
    currentGraph = JSON.parse(content);
    lastModified = new Date().toISOString();
    etag = `"${Buffer.from(lastModified).toString('base64').slice(0, 16)}"`;
    console.log(`Loaded graph from ${GRAPH_FILE}`);
  } catch (error) {
    console.log(`No graph file at ${GRAPH_FILE}, starting empty`);
    currentGraph = { schemaVersion: 1, nodes: [], edges: [] };
    lastModified = new Date().toISOString();
  }
}

async function saveGraph(graph) {
  try {
    await Bun.write(GRAPH_FILE, JSON.stringify(graph, null, 2));
    currentGraph = graph;
    lastModified = new Date().toISOString();
    etag = `"${Buffer.from(lastModified).toString('base64').slice(0, 16)}"`;
    return true;
  } catch (error) {
    console.error('Failed to save graph:', error);
    return false;
  }
}

const server = createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key, If-None-Match',
    });
    res.end();
    return;
  }

  // Health check - no auth required
  if (req.url === '/api/polling/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, timestamp: new Date().toISOString() });
    return;
  }

  // All other endpoints require auth
  const authHeader = req.headers['x-api-key'];
  if (req.headers['x-api-key'] !== API_KEY) {
    sendJson(res, 401, { error: 'Missing or invalid X-API-Key header.' });
    return;
  }

  // GET /api/graph - Get current graph with conditional request support
  if (req.url === '/api/graph' && req.method === 'GET') {
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch && ifNoneMatch === etag) {
      res.writeHead(304, {
        'ETag': etag,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }
    sendJson(res, 200, {
      graph: currentGraph,
      timestamp: lastModified,
    }, { 'ETag': etag || '' });
    return;
  }

  // POST /api/graph - Replace entire graph
  if (req.url === '/api/graph' && req.method === 'POST') {
    try {
      const body = await new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size > 10 * 1024 * 1024) {
            reject(new Error('Request body too large.'));
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
      });
      const parsed = JSON.parse(body);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
        sendJson(res, 400, { error: 'Invalid graph: must have nodes[] and edges[] arrays' });
        return;
      }
      const saved = await saveGraph(parsed);
      if (saved) {
        sendJson(res, 200, { ok: true, timestamp: lastModified });
      } else {
        sendJson(res, 500, { error: 'Failed to save graph' });
      }
    } catch (error) {
      sendJson(res, error instanceof SyntaxError ? 400 : 500, { error: error.message });
    }
    return;
  }

  // POST /api/graph/patch - Partial update (merge nodes/edges)
  if (req.url === '/api/graph/patch' && req.method === 'POST') {
    try {
      const body = await new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size > 5 * 1024 * 1024) {
            reject(new Error('Request body too large.'));
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
      });
      const patch = JSON.parse(body);
      const merged = { ...currentGraph };
      if (patch.nodes) {
        const nodeMap = new Map(merged.nodes.map(n => [n.id, n]));
        for (const node of patch.nodes) {
          if (node.id) nodeMap.set(node.id, { ...nodeMap.get(node.id), ...node });
          else nodeMap.set(`node-${randomUUID()}`, node);
        }
        merged.nodes = Array.from(nodeMap.values());
      }
      if (patch.edges) {
        const edgeMap = new Map(merged.edges.map(e => [e.id, e]));
        for (const edge of patch.edges) {
          if (edge.id) edgeMap.set(edge.id, { ...edgeMap.get(edge.id), ...edge });
          else edgeMap.set(`edge-${randomUUID()}`, edge);
        }
        merged.edges = Array.from(edgeMap.values());
      }
      const saved = await saveGraph(merged);
      if (saved) {
        sendJson(res, 200, { ok: true, timestamp: lastModified });
      } else {
        sendJson(res, 500, { error: 'Failed to save graph' });
      }
    } catch (error) {
      sendJson(res, error instanceof SyntaxError ? 400 : 500, { error: error.message });
    }
    return;
  }

  // POST /api/control - Trigger control events (stored for browser to poll)
  if (req.url === '/api/control' && req.method === 'POST') {
    try {
      const body = await new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size > 4096) { reject(new Error('Request body too large.')); req.destroy(); return; }
          chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
      });
      const input = JSON.parse(body);
      if (!input || !input.mappingId || !input.event || !['press', 'release', 'value'].includes(input.event.type)) {
        sendJson(res, 400, { error: 'Expected mappingId and event (press/release/value)' });
        return;
      }
      // Store control event for browser to pick up
      if (!global.controlEvents) global.controlEvents = [];
      global.controlEvents.push({
        id: randomUUID(),
        mappingId: input.mappingId,
        event: input.event,
        timestamp: new Date().toISOString(),
        requestId: input.requestId || randomUUID(),
      });
      // Keep only last 100 events
      if (global.controlEvents.length > 100) global.controlEvents = global.controlEvents.slice(-100);
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, error instanceof SyntaxError ? 400 : 500, { error: error.message });
    }
    return;
  }

  // GET /api/control/events - Poll for control events
  if (req.url === '/api/control/events' && req.method === 'GET') {
    const since = req.headers['if-none-match']; // reuse header for cursor
    const events = global.controlEvents || [];
    const filtered = since ? events.filter(e => e.id > since) : events.slice(-10);
    sendJson(res, 200, { events: filtered });
    return;
  }

  sendJson(res, 404, { error: 'Not found.' });
});

server.listen(PORT, HOST, () => {
  loadGraph();
  console.log(`VideoBrain polling API listening on http://${HOST}:${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  GET  /api/polling/health     - Health check`);
  console.log(`  GET  /api/graph              - Get full graph (with ETag)`);
  console.log(`  POST /api/graph              - Replace entire graph`);
  console.log(`  POST /api/graph/patch        - Partial graph update`);
  console.log(`  POST /api/control            - Queue control event`);
  console.log(`  GET  /api/control/events     - Poll for control events`);
});