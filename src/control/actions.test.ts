import { describe, expect, it } from 'vitest';
import { createGraphNode, GRAPH_SCHEMA_VERSION } from '../graph';
import { createProjectStore } from '../store/projectStore';
import { createControlActions, type ControlAction } from './actions';

function fixture() {
  const store = createProjectStore({ storage: null, initialDocument: {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [createGraphNode('crossfade', { x: 0, y: 0 }, {}, 'mix'), createGraphNode('sourceSelector', { x: 0, y: 0 }, {}, 'router')], edges: [],
  } });
  let resets = 0;
  const actions = createControlActions(store, () => { resets++; });
  const action: ControlAction = { type: 'parameter', nodeId: 'mix', paramId: 'mix', mode: 'absolute', low: 0, high: 1 };
  return { store, actions, action, resets: () => resets, value: () => store.getState().document.nodes[0]?.params.mix };
}

describe('controller actions', () => {
  it('scales, snaps, and rejects invalid values', () => {
    const { actions, action, value } = fixture();
    actions.execute('knob', action, { type: 'value', value: 0.126 });
    expect(value()).toBe(0.13);
    expect(() => actions.execute('knob', action, { type: 'value', value: NaN })).toThrow();
    expect(() => actions.execute('knob', action, { type: 'value', value: 2 })).toThrow();
  });
  it('restores momentary values on release/disconnect without overwriting manual edits', () => {
    const { store, actions, action, value } = fixture();
    const momentary = { ...action, mode: 'momentary' } as ControlAction;
    actions.execute('key', momentary, { type: 'press' });
    expect(value()).toBe(1);
    actions.execute('key', momentary, { type: 'press' });
    actions.releaseAll();
    expect(value()).toBe(0.5);
    actions.execute('key', momentary, { type: 'press' });
    store.getState().setNodeParam('mix', 'mix', 0.2);
    actions.releaseAll();
    expect(value()).toBe(0.2);
  });
  it('toggles on press edges and advances a router with wrap', () => {
    const { store, actions, action, value } = fixture();
    const toggle = { ...action, mode: 'toggle' } as ControlAction;
    actions.execute('key', toggle, { type: 'press' });
    actions.execute('key', toggle, { type: 'press' });
    expect(value()).toBe(1);
    actions.release('key');
    actions.execute('key', toggle, { type: 'press' });
    expect(value()).toBe(0);
    store.getState().setNodeParam('router', 'index', 3);
    actions.execute('next', { type: 'source', nodeId: 'router', mode: 'advance', index: 0 }, { type: 'press' });
    expect(store.getState().document.nodes[1]?.params.index).toBe(0);
  });
  it('controls transport without changing the graph', () => {
    const { store, actions, resets } = fixture();
    actions.execute('pause', { type: 'transport', command: 'pause' }, { type: 'press' });
    expect(store.getState().playing).toBe(false);
    actions.execute('reset', { type: 'transport', command: 'reset' }, { type: 'press' });
    expect(resets()).toBe(1);
    expect(store.getState().canUndo).toBe(false);
  });
});