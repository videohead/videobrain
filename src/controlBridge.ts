// Opt-in WebSocket bridge that lets the control API (server/control-server.mjs)
// read and replace the live project via the zustand store. Disabled unless
// VITE_CONTROL_BRIDGE_URL is set, so production/static builds never dial out.
import { projectStore } from './store';

const RECONNECT_DELAY_MS = 2000;

interface BridgeMessage {
  type: 'request-state' | 'apply';
  requestId: string;
  payload?: unknown;
}

function handleMessage(socket: WebSocket, raw: string): void {
  let message: BridgeMessage;
  try {
    message = JSON.parse(raw) as BridgeMessage;
  } catch {
    return;
  }

  if (message.type === 'request-state') {
    const graphJson = projectStore.getState().exportProject();
    socket.send(JSON.stringify({ type: 'state', requestId: message.requestId, payload: graphJson }));
    return;
  }

  if (message.type === 'apply') {
    const result = projectStore.getState().importProject(message.payload);
    socket.send(
      JSON.stringify({
        type: 'ack',
        requestId: message.requestId,
        ok: result.ok,
        error: result.ok ? undefined : result.error,
      }),
    );
  }
}

export function startControlBridge(url: string): void {
  let closedByUs = false;

  const connect = (): void => {
    const socket = new WebSocket(url);
    socket.addEventListener('message', (event) => {
      handleMessage(socket, String(event.data));
    });
    socket.addEventListener('close', () => {
      if (!closedByUs) setTimeout(connect, RECONNECT_DELAY_MS);
    });
    socket.addEventListener('error', () => socket.close());
  };

  connect();

  window.addEventListener('beforeunload', () => {
    closedByUs = true;
  });
}
