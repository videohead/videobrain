import { boundedText, MAX_DATA_TEXT } from '../graph/data';
import type { CompiledGraph, GraphNode } from '../graph';

export interface DataSnapshot { text: string; status: number; error: string; active: boolean; preview: string }
const EMPTY: DataSnapshot = Object.freeze({ text: '', status: 0, error: '', active: false, preview: '' });
interface Session {
  snapshot: DataSnapshot;
  abort?: AbortController;
  socket?: WebSocket;
  events?: EventSource;
  timer?: ReturnType<typeof setTimeout>;
  lastAction: number;
  rateStart: number;
  count: number;
  generation: number;
}
const NETWORK_KINDS = new Set(['httpFetch', 'dataSocket', 'serverEvents']);
export function dataUrl(value: string, websocket = false): string {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.hash ||
    !(websocket ? url.protocol === 'wss:' || local && url.protocol === 'ws:' : url.protocol === 'https:' || local && url.protocol === 'http:')) {
    throw new Error('Use HTTPS/WSS, or HTTP/WS on loopback. Credentials and fragments are not supported.');
  }
  return url.href;
}

export class DataSessions {
  private sessions = new Map<string, Session>();
  private nodes = new Map<string, GraphNode>();
  private sendValues = new Map<string, string>();
  private listeners = new Set<() => void>();
  private notification: ReturnType<typeof setTimeout> | undefined;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = (id: string): DataSnapshot => this.sessions.get(id)?.snapshot ?? EMPTY;
  private session(id: string) {
    let session = this.sessions.get(id);
    if (!session) {
      session = { snapshot: EMPTY, lastAction: -Infinity, generation: 0, rateStart: 0, count: 0 };
      this.sessions.set(id, session);
    }
    return session;
  }
  private publish(id: string, patch: Partial<DataSnapshot>) {
    const session = this.session(id);
    const next = { ...session.snapshot, ...patch };
    if (JSON.stringify(next) === JSON.stringify(session.snapshot)) return;
    session.snapshot = next;
    if (this.notification === undefined) this.notification = setTimeout(() => {
      this.notification = undefined;
      this.listeners.forEach((listener) => listener());
      window.dispatchEvent(new Event('videobrain:data-ready'));
    }, 100);
  }
  reconcile(plan: CompiledGraph | null) {
    const next = new Map((plan?.controlNodes ?? []).map(({ node }) => [node.id, node]));
    for (const [id, old] of this.nodes) {
      const node = next.get(id);
      if (!node || old.kind !== node.kind || JSON.stringify(old.params) !== JSON.stringify(node.params)) {
        this.stop(id);
        this.sessions.delete(id);
        this.sendValues.delete(id);
      }
    }
    this.nodes = next;
  }
  report(id: string, preview: string, error = '') { this.publish(id, { preview: preview.slice(0, 2048), error }); }
  input(id: string, value: string) { this.sendValues.set(id, value); }
  stop(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;
    session.generation++;
    session.abort?.abort();
    if (session.socket) { session.socket.onclose = null; session.socket.onmessage = null; session.socket.onerror = null; session.socket.close(); }
    session.events?.close();
    clearTimeout(session.timer);
    session.abort = undefined; session.socket = undefined; session.events = undefined;
    this.publish(id, { active: false, status: 0 });
  }
  dispose() {
    for (const id of this.sessions.keys()) this.stop(id);
    clearTimeout(this.notification); this.notification = undefined;
    this.sessions.clear(); this.nodes.clear(); this.sendValues.clear();
    this.listeners.forEach((listener) => listener());
  }
  private receive(id: string, text: string, generation: number) {
    const session = this.session(id);
    if (session.generation !== generation) return;
    if (Date.now() - session.rateStart > 1000) { session.rateStart = Date.now(); session.count = 0; }
    if (++session.count > 30) throw new Error('Incoming message limit: 30 per second.');
    this.publish(id, { text: boundedText(text), error: '', status: 1 });
  }
  async action(id: string, action: 'start' | 'send' | 'read' | 'write' | 'delete'): Promise<void> {
    const node = this.nodes.get(id);
    if (!node) { this.publish(id, { error: 'Connect this node to Display or Inspect first.' }); return; }
    const session = this.session(id);
    try {
      if (Date.now() - session.lastAction < 250) throw new Error('Wait 250 ms between actions.');
      session.lastAction = Date.now();
      if (node.kind === 'dataStorage') {
        const key = String(node.params.key);
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key)) throw new Error('Storage key: 1-64 letters, digits, underscores or hyphens.');
        const storageKey = `videobrain.data.v1.${key}`;
        if (action === 'write') {
          let count = 0;
          for (let index = 0; index < localStorage.length; index++) if (localStorage.key(index)?.startsWith('videobrain.data.v1.')) count++;
          if (localStorage.getItem(storageKey) === null && count >= 32) throw new Error('Storage is limited to 32 keys.');
          localStorage.setItem(storageKey, boundedText(this.sendValues.get(id) ?? String(node.params.text)));
        } else if (action === 'delete') localStorage.removeItem(storageKey);
        else if (action !== 'read') throw new Error('Invalid storage action.');
        this.publish(id, { text: boundedText(localStorage.getItem(storageKey) ?? ''), status: 1, error: '' });
        return;
      }
      if (action === 'send' && node.kind === 'dataSocket') {
        if (!session.socket || session.socket.readyState !== WebSocket.OPEN) throw new Error('Connect before sending.');
        if (session.socket.bufferedAmount > MAX_DATA_TEXT) throw new Error('WebSocket send queue is full.');
        session.socket.send(boundedText(this.sendValues.get(id) ?? String(node.params.text)));
        return;
      }
      if (action !== 'start' || !NETWORK_KINDS.has(node.kind)) throw new Error('Invalid data action.');
      const active = [...this.sessions.values()].filter((candidate) => candidate.snapshot.active).length;
      if (!session.snapshot.active && active >= 8) throw new Error('At most eight network sessions may be active.');
      const url = dataUrl(String(node.params.url), node.kind === 'dataSocket');
      this.stop(id);
      const generation = session.generation;
      this.publish(id, { text: '', status: 0, error: '', active: true });
      const failed = (error: unknown) => {
        if (session.generation !== generation) return;
        this.stop(id);
        this.publish(id, { error: error instanceof Error ? error.message : 'Network request failed.' });
      };
      if (node.kind === 'httpFetch') {
        session.abort = new AbortController();
        session.timer = setTimeout(() => failed(new Error('Fetch timed out after 10 seconds.')), 10000);
        try {
          const response = await fetch(url, { signal: session.abort.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const reader = response.body?.getReader();
          if (!reader) throw new Error('Streaming response body is unavailable.');
          const decoder = new TextDecoder('utf-8', { fatal: true });
          let size = 0;
          let text = '';
          try {
            while (true) {
              const result = await reader.read();
              if (result.done) break;
              size += result.value.byteLength;
              if (size > MAX_DATA_TEXT) { await reader.cancel(); throw new Error('Response exceeds 32 KiB.'); }
              text += decoder.decode(result.value, { stream: true });
            }
            text += decoder.decode();
          } finally { reader.releaseLock(); }
          if (session.generation !== generation) return;
          clearTimeout(session.timer);
          this.publish(id, { text: boundedText(text), active: false, status: response.status, error: '' });
        } catch (error) { failed(error); }
      } else if (node.kind === 'dataSocket') {
        const socket = new WebSocket(url);
        session.socket = socket;
        session.timer = setTimeout(() => failed(new Error('WebSocket connection timed out.')), 10000);
        socket.onopen = () => { if (session.generation === generation) { clearTimeout(session.timer); this.publish(id, { status: 1 }); } };
        socket.onmessage = (event) => {
          try { if (typeof event.data !== 'string') throw new Error('Only text WebSocket messages are supported.'); this.receive(id, event.data, generation); } catch (error) { failed(error); }
        };
        socket.onerror = () => failed(new Error('WebSocket connection failed.'));
        socket.onclose = () => failed(new Error('WebSocket closed. Reconnect explicitly.'));
      } else {
        const events = new EventSource(url, { withCredentials: false });
        session.events = events;
        session.timer = setTimeout(() => failed(new Error('EventSource connection timed out.')), 10000);
        events.onopen = () => { if (session.generation === generation) { clearTimeout(session.timer); this.publish(id, { status: 1 }); } };
        events.onmessage = (event) => { try { this.receive(id, String(event.data), generation); } catch (error) { failed(error); } };
        events.onerror = () => failed(new Error('EventSource disconnected. Reconnect explicitly.'));
      }
    } catch (error) { this.publish(id, { error: error instanceof Error ? error.message : 'Data action failed.' }); }
  }
}

export const dataSessions = new DataSessions();