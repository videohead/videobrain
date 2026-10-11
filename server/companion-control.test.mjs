import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { attachCompanionControl } from './companion-control.mjs';

test('Companion requires auth, validates commands, relays acknowledgements and deduplicates', async () => {
  const key = 'test-only-key';
  const server = createServer(async (request, response) => { if (!await bridge.handle(request, response)) { response.writeHead(404); response.end(); } });
  const bridge = attachCompanionControl(server, { apiKey: key, allowedOrigins: ['https://studio.test'] });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const root = `http://127.0.0.1:${address.port}`;
  let socket;
  try {
    assert.equal((await fetch(`${root}/api/control/status`)).status, 401);
    socket = new WebSocket(`ws://127.0.0.1:${address.port}/control-ws`, { origin: 'https://studio.test' });
    await once(socket, 'open');
    const ready = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'authenticate', token: key }));
    assert.equal(JSON.parse((await ready)[0].toString()).type, 'ready');
    let received = 0;
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'control') { received++; socket.send(JSON.stringify({ type: 'ack', requestId: message.requestId, ok: true })); }
    });
    const post = (body) => fetch(`${root}/api/control`, { method: 'POST', headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const input = { requestId: 'one', mappingId: 'next', event: { type: 'press' } };
    assert.equal((await post(input)).status, 200);
    assert.equal((await post(input)).status, 200);
    assert.equal(received, 1);
    assert.equal((await post({ ...input, event: { type: 'release' } })).status, 409);
    assert.equal((await post({ ...input, requestId: 'bad', event: { type: 'value', value: 5 } })).status, 400);
    const denied = new WebSocket(`ws://127.0.0.1:${address.port}/control-ws`, { origin: 'https://untrusted.test' });
    const [error] = await once(denied, 'error');
    assert.match(error.message, /403/);
  } finally {
    socket?.terminate();
    bridge.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});