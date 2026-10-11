import { projectStore } from '../store';
import { createControlActions, type ControlAction, type ControlEvent } from './actions';

export interface MidiBinding { deviceId: string; channel: number; type: 'cc' | 'note'; number: number }
export interface ControlMapping { id: string; name: string; action: ControlAction; midi?: MidiBinding }
interface ControllerState {
  mappings: ControlMapping[];
  armed: boolean;
  midiState: string;
  devices: { id: string; name: string }[];
  learning: string | null;
  bridgeState: string;
  error: string | null;
}
const STORAGE_KEY = 'videobrain.controllers.v1';
const listeners = new Set<() => void>();
let state: ControllerState = { mappings: [], armed: false, midiState: 'Off', devices: [], learning: null, bridgeState: 'Disconnected', error: null };
let resetTransport: () => void = () => { throw new Error('Transport is unavailable.'); };
const actions = createControlActions(projectStore, () => resetTransport());
let midi: MIDIAccess | null = null;
const midiInputs = new Map<string, MIDIInput>();
let midiGeneration = 0;
let bridge: WebSocket | null = null;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let gestureTimer: ReturnType<typeof setTimeout> | undefined;
let activeGesture = false;
const pendingValues = new Map<string, number>();
let valueTimer: ReturnType<typeof setTimeout> | undefined;
let leaseTimer: ReturnType<typeof setInterval> | undefined;
const leases = new Map<string, number>();

function update(patch: Partial<ControllerState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function scalar(value: unknown): value is number | string | boolean {
  return typeof value === 'boolean' || typeof value === 'string' && value.length <= 128 || typeof value === 'number' && Number.isFinite(value);
}
export function parseMapping(value: unknown): ControlMapping {
  if (!record(value) || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.id) ||
    typeof value.name !== 'string' || value.name.length < 1 || value.name.length > 80 || !record(value.action)) throw new Error('Invalid mapping.');
  const input = value.action;
  let action: ControlAction;
  if (input.type === 'transport' && ['play', 'pause', 'toggle', 'reset'].includes(String(input.command))) {
    action = { type: 'transport', command: input.command as 'play' | 'pause' | 'toggle' | 'reset' };
  } else if (input.type === 'source' && typeof input.nodeId === 'string' && input.nodeId.length <= 128 &&
    (input.mode === 'select' || input.mode === 'advance') && Number.isInteger(input.index) && Number(input.index) >= 0 && Number(input.index) <= 3) {
    action = { type: 'source', nodeId: input.nodeId, mode: input.mode, index: Number(input.index) };
  } else if (input.type === 'parameter' && typeof input.nodeId === 'string' && input.nodeId.length <= 128 &&
    typeof input.paramId === 'string' && input.paramId.length <= 128 && ['absolute', 'set', 'toggle', 'momentary'].includes(String(input.mode)) && scalar(input.low) && scalar(input.high)) {
    action = { type: 'parameter', nodeId: input.nodeId, paramId: input.paramId, mode: input.mode as 'absolute' | 'set' | 'toggle' | 'momentary', low: input.low, high: input.high };
  } else throw new Error('Invalid action.');
  let binding: MidiBinding | undefined;
  if (value.midi !== undefined) {
    const inputMidi = value.midi;
    if (!record(inputMidi) || typeof inputMidi.deviceId !== 'string' || inputMidi.deviceId.length > 256 ||
      !Number.isInteger(inputMidi.channel) || Number(inputMidi.channel) < 1 || Number(inputMidi.channel) > 16 ||
      !Number.isInteger(inputMidi.number) || Number(inputMidi.number) < 0 || Number(inputMidi.number) > 127 ||
      (inputMidi.type !== 'cc' && inputMidi.type !== 'note')) throw new Error('Invalid MIDI binding.');
    binding = { deviceId: inputMidi.deviceId, channel: Number(inputMidi.channel), number: Number(inputMidi.number), type: inputMidi.type };
  }
  return { id: value.id, name: value.name, action, ...(binding ? { midi: binding } : {}) };
}

export function decodeMidi(data: Uint8Array): { channel: number; type: 'cc' | 'note'; number: number; event: ControlEvent } | null {
  const [status, number, value] = data;
  if (status === undefined || number === undefined || value === undefined || data.length !== 3 || number > 127 || value > 127) return null;
  const command = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  if (command === 0xb0) return { channel, type: 'cc', number, event: { type: 'value', value: value / 127 } };
  if (command === 0x80 || command === 0x90) return { channel, type: 'note', number, event: { type: command === 0x80 || value === 0 ? 'release' : 'press' } };
  return null;
}

function persist(mappings: ControlMapping[]) {
  if (mappings.length > 128) throw new Error('At most 128 mappings are supported.');
  if (new Set(mappings.map(({ id }) => id)).size !== mappings.length) throw new Error('Mapping IDs must be unique.');
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, mappings }));
  update({ mappings, error: null });
}
function endGesture() {
  clearTimeout(gestureTimer);
  if (activeGesture) projectStore.getState().endGesture();
  activeGesture = false;
}
function releaseAll() {
  clearTimeout(valueTimer);
  valueTimer = undefined;
  pendingValues.clear();
  endGesture();
  actions.releaseAll();
  leases.clear();
}
function execute(id: string, event: ControlEvent, origin: 'midi' | 'companion') {
  if (event.type === 'release') { actions.release(`${origin}:${id}`); leases.delete(`${origin}:${id}`); return; }
  if (!state.armed) throw new Error('Controllers are disarmed.');
  const mapping = state.mappings.find((candidate) => candidate.id === id);
  if (!mapping) throw new Error('Unknown mapping ID.');
  if (event.type === 'value' && mapping.action.type === 'parameter' && mapping.action.mode === 'absolute') {
    if (!activeGesture) { projectStore.getState().beginGesture(); activeGesture = true; }
    clearTimeout(gestureTimer);
    gestureTimer = setTimeout(endGesture, 250);
  } else endGesture();
  actions.execute(`${origin}:${id}`, mapping.action, event);
  if (event.type === 'press') leases.set(`${origin}:${id}`, Date.now());
}
function receiveMidi(deviceId: string, data: Uint8Array) {
  const message = decodeMidi(data);
  if (!message) return;
  try {
    if (state.learning && message.event.type !== 'release') {
      const { channel, type, number } = message;
      persist(state.mappings.map((mapping) => mapping.id === state.learning ? { ...mapping, midi: { deviceId, channel, type, number } } : mapping));
      update({ learning: null });
      return;
    }
    for (const mapping of state.mappings) {
      const binding = mapping.midi;
      if (!binding || binding.deviceId !== deviceId || binding.channel !== message.channel || binding.type !== message.type || binding.number !== message.number) continue;
      const event: ControlEvent = message.event.type === 'value' && !(mapping.action.type === 'parameter' && mapping.action.mode === 'absolute')
        ? { type: message.event.value >= 0.5 ? 'press' : 'release' } : message.event;
      if (event.type === 'value') {
        pendingValues.set(mapping.id, event.value);
        if (valueTimer === undefined) valueTimer = setTimeout(() => {
          valueTimer = undefined;
          for (const [id, value] of pendingValues) {
            try { execute(id, { type: 'value', value }, 'midi'); } catch (error) { report(error); }
          }
          pendingValues.clear();
        }, 33);
      } else execute(mapping.id, event, 'midi');
    }
  } catch (error) { report(error); }
}
function report(error: unknown) { update({ error: error instanceof Error ? error.message : 'Controller operation failed.' }); }

export function validateBridgeUrl(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.hash || url.search ||
    !(url.protocol === 'wss:' || url.protocol === 'ws:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Use WSS, or credential-free URL syntax with WS on loopback only.');
  }
  return url.href;
}

export const controller = {
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  snapshot: () => state,
  initialize: (reset: () => void) => {
    resetTransport = reset;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw && raw.length <= 131072) {
        const saved: unknown = JSON.parse(raw);
        if (!record(saved) || saved.version !== 1 || !Array.isArray(saved.mappings) || saved.mappings.length > 128) throw new Error('Invalid saved controller mappings.');
        const mappings = saved.mappings.map(parseMapping);
        if (new Set(mappings.map(({ id }) => id)).size !== mappings.length) throw new Error('Duplicate mapping IDs.');
        update({ mappings });
      }
    } catch (error) { report(error); }
    const blur = () => { releaseAll(); update({ armed: false }); };
    window.addEventListener('blur', blur);
    const unsubscribe = projectStore.subscribe((next, previous) => {
      if (next.document.nodes.length !== previous.document.nodes.length || next.document.nodes.some((node, index) => node.id !== previous.document.nodes[index]?.id || node.kind !== previous.document.nodes[index]?.kind)) {
        endGesture();
        actions.releaseAll();
        leases.clear();
        pendingValues.clear();
        clearTimeout(valueTimer);
        valueTimer = undefined;
        update({ armed: false });
      }
    });
    leaseTimer = setInterval(() => {
      for (const [id, started] of leases) if (Date.now() - started > 10000) { actions.release(id); leases.delete(id); }
    }, 500);
    return () => { window.removeEventListener('blur', blur); unsubscribe(); clearInterval(leaseTimer); controller.disableMidi(); controller.disconnect(); releaseAll(); update({ armed: false }); };
  },
  arm: (armed: boolean) => { releaseAll(); update({ armed, error: null, learning: null }); },
  save: (mapping: ControlMapping) => {
    try { const clean = parseMapping(mapping); releaseAll(); persist([...state.mappings.filter(({ id }) => id !== clean.id), clean]); } catch (error) { report(error); }
  },
  remove: (id: string) => { try { releaseAll(); persist(state.mappings.filter((mapping) => mapping.id !== id)); } catch (error) { report(error); } },
  learn: (id: string | null) => { releaseAll(); update({ learning: id, ...(id ? { armed: false } : {}), error: null }); },
  enableMidi: async () => {
    const generation = ++midiGeneration;
    try {
      if (!navigator.requestMIDIAccess) throw new Error('Web MIDI is unavailable. Use a supported HTTPS browser.');
      update({ midiState: 'Requesting', error: null });
      const access = await navigator.requestMIDIAccess({ sysex: false });
      if (generation !== midiGeneration) { access.inputs.forEach((input) => { void input.close().catch(() => undefined); }); return; }
      midi = access;
      const refresh = () => {
        const devices: ControllerState['devices'] = [];
        for (const [id, input] of midiInputs) {
          if (input.state !== 'connected' || access.inputs.get(id) !== input) {
            input.onmidimessage = null;
            midiInputs.delete(id);
            releaseAll();
          }
        }
        access.inputs.forEach((input) => {
          if (input.state !== 'connected') return;
          devices.push({ id: input.id, name: input.name ?? 'MIDI input' });
          if (!midiInputs.has(input.id)) {
            midiInputs.set(input.id, input);
            input.onmidimessage = (event) => { if (event.data) receiveMidi(input.id, event.data); };
          }
        });
        update({ devices, midiState: 'Enabled' });
      };
      access.onstatechange = refresh;
      refresh();
    } catch (error) { if (generation === midiGeneration) { update({ midiState: 'Unavailable' }); report(error); } }
  },
  disableMidi: () => {
    midiGeneration++;
    if (midi) { midi.onstatechange = null; midi.inputs.forEach((input) => { input.onmidimessage = null; void input.close().catch(() => undefined); }); }
    midi = null;
    midiInputs.clear();
    releaseAll();
    update({ midiState: 'Off', devices: [], learning: null });
  },
  disconnect: () => {
    clearInterval(heartbeat);
    if (bridge) { const socket = bridge; bridge = null; socket.close(); }
    releaseAll();
    update({ bridgeState: 'Disconnected' });
  },
  connect: (address: string, token: string) => {
    try {
      const url = validateBridgeUrl(address);
      if (!token || token.length > 512) throw new Error('Enter the Companion bridge key.');
      controller.disconnect();
      const socket = new WebSocket(url);
      bridge = socket;
      update({ bridgeState: 'Connecting', error: null });
      socket.onopen = () => socket.send(JSON.stringify({ type: 'authenticate', token }));
      socket.onmessage = (event) => {
        if (bridge !== socket || typeof event.data !== 'string' || event.data.length > 4096) return;
        try {
          const message: unknown = JSON.parse(event.data);
          if (!record(message)) return;
          if (message.type === 'ready') {
            update({ bridgeState: 'Connected' });
            heartbeat = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'heartbeat' })); }, 3000);
            return;
          }
          if (message.type !== 'control' || typeof message.requestId !== 'string' || typeof message.mappingId !== 'string') return;
          let error: string | undefined;
          try {
            const input = message.event;
            if (!record(input) || !['press', 'release', 'value'].includes(String(input.type))) throw new Error('Invalid control event.');
            if (input.type === 'value' && (typeof input.value !== 'number' || !Number.isFinite(input.value) || input.value < 0 || input.value > 1)) throw new Error('Invalid normalized value.');
            execute(message.mappingId, input.type === 'value' ? { type: 'value', value: Number(input.value) } : { type: input.type as 'press' | 'release' }, 'companion');
          } catch (failure) { error = failure instanceof Error ? failure.message : 'Control failed.'; update({ error }); }
          socket.send(JSON.stringify({ type: 'ack', requestId: message.requestId, ok: !error, ...(error ? { error } : {}) }));
        } catch { update({ error: 'Invalid bridge message.' }); }
      };
      socket.onclose = () => { if (bridge === socket) controller.disconnect(); };
      socket.onerror = () => { if (bridge === socket) { controller.disconnect(); update({ error: 'Companion bridge connection failed.' }); } };
    } catch (error) { report(error); }
  },
};