import { OPERATOR_REGISTRY, type GraphParamValue } from '../graph';
import type { ProjectStoreApi } from '../store/projectStore';

export type ControlAction =
  | { type: 'parameter'; nodeId: string; paramId: string; mode: 'absolute' | 'set' | 'toggle' | 'momentary'; low: GraphParamValue; high: GraphParamValue }
  | { type: 'source'; nodeId: string; mode: 'select' | 'advance'; index: number }
  | { type: 'transport'; command: 'play' | 'pause' | 'toggle' | 'reset' };

export type ControlEvent = { type: 'value'; value: number } | { type: 'press' | 'release' };

interface HeldParameter {
  nodeId: string;
  paramId: string;
  previous: GraphParamValue;
  applied: GraphParamValue;
}

export function createControlActions(store: ProjectStoreApi, reset: () => void) {
  const held = new Map<string, HeldParameter>();
  const pressed = new Set<string>();

  const target = (nodeId: string, paramId: string) => {
    const document = store.getState().document;
    const node = document.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw new Error('The mapped node is missing.');
    const definition = OPERATOR_REGISTRY[node.kind];
    const parameter = definition.params[paramId];
    if (!parameter || parameter.type === 'text') throw new Error('This parameter cannot be controlled.');
    if (document.edges.some(({ target }) => target.nodeId === nodeId &&
      (target.portId === paramId || node.kind === 'sourceSelector' && target.portId === 'trigger'))) {
      throw new Error('Disconnect the graph input before controlling this parameter.');
    }
    return { node, parameter };
  };

  const validateValue = (nodeId: string, paramId: string, value: GraphParamValue) => {
    const { parameter } = target(nodeId, paramId);
    if (parameter.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < parameter.min || value > parameter.max) {
        throw new Error('Value is outside the parameter range.');
      }
    } else if (parameter.type === 'boolean') {
      if (typeof value !== 'boolean') throw new Error('A boolean value is required.');
    } else if (typeof value !== 'string' || !parameter.options.some((option) => option.value === value)) {
      throw new Error('Choose a valid parameter option.');
    }
    return parameter;
  };

  const release = (id: string) => {
    pressed.delete(id);
    const entry = held.get(id);
    held.delete(id);
    if (!entry) return;
    const node = store.getState().document.nodes.find((candidate) => candidate.id === entry.nodeId);
    if (node && Object.is(node.params[entry.paramId], entry.applied)) {
      store.getState().setNodeParam(entry.nodeId, entry.paramId, entry.previous);
    }
  };

  const execute = (id: string, action: ControlAction, event: ControlEvent) => {
    if (event.type === 'release') { release(id); return; }
    if (event.type === 'value' && (!Number.isFinite(event.value) || event.value < 0 || event.value > 1)) {
      throw new Error('Control values must be between 0 and 1.');
    }
    if (event.type === 'press' && pressed.has(id)) return;
    if (action.type === 'transport') {
      if (event.type !== 'press') return;
      if (action.command === 'reset') reset();
      else if (action.command === 'toggle') store.getState().togglePlaying();
      else store.getState().setPlaying(action.command === 'play');
    } else if (action.type === 'source') {
      if (event.type !== 'press') return;
      const { node } = target(action.nodeId, 'index');
      if (node.kind !== 'frameSwitch' && node.kind !== 'sourceSelector') throw new Error('Choose a frame source router.');
      if (!Number.isInteger(action.index) || action.index < 0 || action.index > 3) throw new Error('Source index must be 0 to 3.');
      const next = action.mode === 'advance' ? (Math.round(Number(node.params.index)) + 1) % 4 : action.index;
      store.getState().setNodeParam(node.id, 'index', next);
    } else {
      const parameter = validateValue(action.nodeId, action.paramId, action.high);
      validateValue(action.nodeId, action.paramId, action.low);
      const { node } = target(action.nodeId, action.paramId);
      let value = action.high;
      if (action.mode === 'absolute') {
        if (event.type !== 'value') return;
        if (parameter.type !== 'number' || typeof action.low !== 'number' || typeof action.high !== 'number') throw new Error('Absolute mappings require a numeric parameter.');
        const scaled = action.low + (action.high - action.low) * event.value;
        value = Math.max(parameter.min, Math.min(parameter.max,
          Number((parameter.min + Math.round((scaled - parameter.min) / parameter.step) * parameter.step).toFixed(10)),
        ));
      } else {
        if (event.type !== 'press') return;
        if (action.mode === 'toggle') value = Object.is(node.params[action.paramId], action.high) ? action.low : action.high;
        if (action.mode === 'momentary') {
          if ([...held.values()].some((entry) => entry.nodeId === node.id && entry.paramId === action.paramId)) {
            throw new Error('This parameter is already held by another mapping.');
          }
          held.set(id, { nodeId: node.id, paramId: action.paramId, previous: node.params[action.paramId] ?? parameter.defaultValue, applied: value });
        }
      }
      store.getState().setNodeParam(node.id, action.paramId, value);
    }
    if (event.type === 'press') pressed.add(id);
  };

  return {
    execute,
    release,
    releaseAll: () => { for (const id of [...pressed, ...held.keys()]) release(id); },
    forget: () => { pressed.clear(); held.clear(); },
  };
}