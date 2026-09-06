#!/usr/bin/env node
// Realtime control API: relays GET/POST JSON to a connected browser tab's
// zustand project store over a WebSocket bridge (see ../src/controlBridge.ts).
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.CONTROL_PORT ?? 8933);
const HOST = process.env.CONTROL_HOST ?? '0.0.0.0';
const API_KEY = process.env.CONTROL_API_KEY;
const REQUEST_TIMEOUT_MS = 5000;

if (!API_KEY) {
  console.error('CONTROL_API_KEY is required.');
  process.exit(1);
}

/** @type {import('ws').WebSocket | null} */
let browserSocket = null;
let lastKnownGraphJson = null;
let lastKnownAt = null;
const pendingRequests = new Map();

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
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

function requestFromBrowser(type) {
  return new Promise((resolve, reject) => {
    if (!browserSocket || browserSocket.readyState !== browserSocket.OPEN) {
      reject(new Error('No VideoBrain tab is connected to the control bridge.'));
      return;
    }
    const requestId = randomUUID();
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('Timed out waiting for the browser tab to respond.'));
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(requestId, { resolve, reject, timer });
    browserSocket.send(JSON.stringify({ type, requestId }));
  });
}

function applyToBrowser(payload) {
  return new Promise((resolve, reject) => {
    if (!browserSocket || browserSocket.readyState !== browserSocket.OPEN) {
      reject(new Error('No VideoBrain tab is connected to the control bridge.'));
      return;
    }
    const requestId = randomUUID();
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('Timed out waiting for the browser tab to respond.'));
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(requestId, { resolve, reject, timer });
    browserSocket.send(JSON.stringify({ type: 'apply', requestId, payload }));
  });
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
    });
    res.end();
    return;
  }

  if (req.url === '/api/graph' && req.method === 'GET') {
    if (!checkAuth(req, res)) return;
    try {
      const graphJson = await requestFromBrowser('request-state');
      lastKnownGraphJson = graphJson;
      lastKnownAt = new Date().toISOString();
      sendJson(res, 200, { graph: JSON.parse(graphJson), stale: false });
    } catch (error) {
      if (lastKnownGraphJson) {
        sendJson(res, 200, {
          graph: JSON.parse(lastKnownGraphJson),
          stale: true,
          staleSince: lastKnownAt,
          error: error.message,
        });
      } else {
        sendJson(res, 503, { error: error.message });
      }
    }
    return;
  }

  if (req.url === '/api/graph' && req.method === 'POST') {
    if (!checkAuth(req, res)) return;
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      const result = await applyToBrowser(parsed);
      if (result.ok) {
        sendJson(res, 200, { ok: true });
      } else {
        sendJson(res, 422, { ok: false, error: result.error });
      }
    } catch (error) {
      sendJson(res, error instanceof SyntaxError ? 400 : 503, { error: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found.' });
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket) => {
  // Single-tab bridge: the most recently connected tab wins.
  browserSocket = socket;

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const pending = pendingRequests.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingRequests.delete(message.requestId);
    if (message.type === 'state') {
      pending.resolve(message.payload);
    } else if (message.type === 'ack') {
      pending.resolve({ ok: message.ok, error: message.error });
    }
  });

  socket.on('close', () => {
    if (browserSocket === socket) browserSocket = null;
  });
});

server.listen(PORT, HOST, () => {
  console.log(`VideoBrain control API listening on http://${HOST}:${PORT} (ws at /ws)`);
});
