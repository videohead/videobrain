import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_GRAPH,
  GRAPH_SCHEMA_VERSION,
  MAX_GRAPH_JSON_BYTES,
  MAX_GRAPH_NODES,
  cloneGraphDocument,
  createGraphNode,
  parseGraphDocument,
  validateConnection,
  type GraphDocument,
} from '../graph';
import {
  PROJECT_STORAGE_VERSION,
  loadStoredProject,
  type ProjectStorage,
} from './persistence';
import { createProjectStore, type ProjectStoreApi } from './projectStore';

class MemoryStorage implements ProjectStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const stores: ProjectStoreApi[] = [];

function makeStore(
  options: Parameters<typeof createProjectStore>[0] = { storage: null },
): ProjectStoreApi {
  const store = createProjectStore(options);
  stores.push(store);
  return store;
}

function connectionFixture(): GraphDocument {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('time', { x: 0, y: 0 }, {}, 'time-a'),
      createGraphNode('oscillator', { x: 100, y: 0 }, {}, 'wave-a'),
      createGraphNode('oscillator', { x: 200, y: 0 }, {}, 'wave-b'),
      createGraphNode('plasma', { x: 100, y: 100 }, {}, 'field-a'),
      createGraphNode('display', { x: 300, y: 100 }, {}, 'display-a'),
    ],
    edges: [],
  };
}

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.dispose();
  }
  vi.useRealTimers();
});

describe('project actions', () => {
  it('adds, moves, updates, selects, and deletes nodes immutably', () => {
    const store = makeStore();
    const original = store.getState().document;
    const nodeId = store
      .getState()
      .addNode('plasma', { x: 12, y: 34 }, { scale: 8 });

    expect(store.getState().document).not.toBe(original);
    expect(store.getState().document.nodes.find(({ id }) => id === nodeId)).toMatchObject({
      kind: 'plasma',
      position: { x: 12, y: 34 },
      params: { scale: 8 },
    });

    store.getState().selectNode(nodeId);
    store.getState().moveNode(nodeId, { x: 40, y: 50 });
    store.getState().setNodeParam(nodeId, 'energy', 0.75);

    expect(store.getState().selectedNodeId).toBe(nodeId);
    expect(store.getState().document.nodes.find(({ id }) => id === nodeId)).toMatchObject({
      position: { x: 40, y: 50 },
      params: { energy: 0.75 },
    });

    store.getState().deleteNode(nodeId);
    expect(store.getState().document.nodes.some(({ id }) => id === nodeId)).toBe(false);
    expect(store.getState().selectedNodeId).toBeNull();
  });

  it('removes attached edges when deleting a node', () => {
    const store = makeStore({
      storage: null,
      initialDocument: connectionFixture(),
    });
    store
      .getState()
      .connect(
        { nodeId: 'field-a', portId: 'frame' },
        { nodeId: 'display-a', portId: 'source' },
      );

    expect(store.getState().document.edges).toHaveLength(1);
    store.getState().deleteNode('field-a');
    expect(store.getState().document.edges).toHaveLength(0);
  });

  it('rejects non-finite positions and parameter values', () => {
    const store = makeStore();

    expect(() =>
      store
        .getState()
        .addNode('plasma', { x: 0, y: 0 }, { scale: Number.NaN }),
    ).toThrow(TypeError);
    expect(() =>
      store.getState().moveNode('field', { x: Number.NaN, y: 0 }),
    ).toThrow(TypeError);
    expect(() =>
      store.getState().setNodeParam('field', 'scale', Number.POSITIVE_INFINITY),
    ).toThrow(TypeError);
  });

  it('rejects schema-invalid edits without changing the document', () => {
    const store = makeStore();
    const before = store.getState().document;

    expect(() => store.getState().setNodeParam('field', 'scale', 99)).toThrow(
      /between 1 and 14/,
    );
    expect(() => store.getState().setNodeParam('field', 'missing', 1)).toThrow(
      /not supported/,
    );
    expect(store.getState().document).toBe(before);
    expect(store.getState().canUndo).toBe(false);
  });

  it('does not add nodes after reaching the document limit', () => {
    const initialDocument: GraphDocument = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes: Array.from({ length: MAX_GRAPH_NODES }, (_, index) =>
        createGraphNode('time', { x: index, y: 0 }, {}, `node-${index}`),
      ),
      edges: [],
    };
    const store = makeStore({ storage: null, initialDocument });
    const before = store.getState().document;

    expect(() =>
      store.getState().addNode('time', { x: 0, y: 0 }),
    ).toThrow(/node limit/);
    expect(store.getState().document).toBe(before);
  });
});

describe('connections', () => {
  it('uses graph validation and mutates only for valid connections', () => {
    const store = makeStore({
      storage: null,
      initialDocument: connectionFixture(),
    });
    const source = { nodeId: 'time-a', portId: 'value' };
    const target = { nodeId: 'field-a', portId: 'time' };
    const expected = validateConnection(store.getState().document, source, target);

    expect(store.getState().connect(source, target)).toEqual(expected);
    expect(store.getState().document.edges).toHaveLength(1);

    const beforeInvalid = store.getState().document;
    const occupied = validateConnection(beforeInvalid, source, target);
    expect(store.getState().connect(source, target)).toEqual(occupied);
    expect(occupied.code).toBe('input-occupied');
    expect(store.getState().document).toBe(beforeInvalid);

    const mismatchTarget = { nodeId: 'display-a', portId: 'source' };
    const mismatch = validateConnection(beforeInvalid, source, mismatchTarget);
    expect(store.getState().connect(source, mismatchTarget)).toEqual(mismatch);
    expect(mismatch.code).toBe('port-type-mismatch');
    expect(store.getState().document).toBe(beforeInvalid);
  });

  it('rejects cycles before mutation', () => {
    const store = makeStore({
      storage: null,
      initialDocument: connectionFixture(),
    });
    expect(
      store.getState().connect(
        { nodeId: 'wave-a', portId: 'value' },
        { nodeId: 'wave-b', portId: 'phase' },
      ).valid,
    ).toBe(true);
    const beforeCycle = store.getState().document;
    const result = store.getState().connect(
      { nodeId: 'wave-b', portId: 'value' },
      { nodeId: 'wave-a', portId: 'phase' },
    );

    expect(result).toMatchObject({ valid: false, code: 'cycle' });
    expect(store.getState().document).toBe(beforeCycle);
  });

  it('disconnects by edge id and supports undo', () => {
    const store = makeStore({
      storage: null,
      initialDocument: connectionFixture(),
    });
    store.getState().connect(
      { nodeId: 'field-a', portId: 'frame' },
      { nodeId: 'display-a', portId: 'source' },
    );
    const edgeId = store.getState().document.edges[0]?.id;
    expect(edgeId).toBeDefined();

    store.getState().disconnect(edgeId ?? 'missing');
    expect(store.getState().document.edges).toHaveLength(0);
    store.getState().undo();
    expect(store.getState().document.edges[0]?.id).toBe(edgeId);
  });
});

describe('history', () => {
  it('coalesces a gesture into one undo snapshot', () => {
    const store = makeStore();
    const original = cloneGraphDocument(store.getState().document);
    store.getState().selectNode('field');
    store.getState().setPlaying(false);

    store.getState().beginGesture();
    store.getState().moveNode('field', { x: 10, y: 20 });
    store.getState().moveNode('field', { x: 30, y: 40 });
    store.getState().setNodeParam('field', 'scale', 11);
    store.getState().endGesture();

    expect(store.getState().canUndo).toBe(true);
    store.getState().undo();
    expect(store.getState().document).toEqual(original);
    expect(store.getState().selectedNodeId).toBe('field');
    expect(store.getState().playing).toBe(false);
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(true);

    store.getState().redo();
    expect(store.getState().document.nodes.find(({ id }) => id === 'field')).toMatchObject({
      position: { x: 30, y: 40 },
      params: { scale: 11 },
    });
    expect(store.getState().selectedNodeId).toBe('field');
    expect(store.getState().playing).toBe(false);
  });

  it('clears redo history after a divergent edit', () => {
    const store = makeStore();
    store.getState().setNodeParam('field', 'scale', 6);
    store.getState().setNodeParam('field', 'scale', 7);
    store.getState().undo();
    expect(store.getState().canRedo).toBe(true);

    store.getState().setNodeParam('field', 'energy', 0.9);
    const divergent = cloneGraphDocument(store.getState().document);
    expect(store.getState().canRedo).toBe(false);
    store.getState().redo();
    expect(store.getState().document).toEqual(divergent);
  });

  it('caps retained snapshots at the configured limit', () => {
    const store = makeStore({ storage: null, historyLimit: 2 });
    store.getState().setNodeParam('field', 'scale', 6);
    store.getState().setNodeParam('field', 'scale', 7);
    store.getState().setNodeParam('field', 'scale', 8);

    store.getState().undo();
    store.getState().undo();
    store.getState().undo();
    expect(
      store.getState().document.nodes.find(({ id }) => id === 'field')?.params.scale,
    ).toBe(6);
    expect(store.getState().canUndo).toBe(false);
  });

  it('resets to a cloned default project and can undo the reset', () => {
    const store = makeStore();
    store.getState().deleteNode('cells');
    const edited = cloneGraphDocument(store.getState().document);
    store.getState().selectNode('field');

    store.getState().resetProject();
    expect(store.getState().document).toEqual(DEFAULT_GRAPH);
    expect(store.getState().document).not.toBe(DEFAULT_GRAPH);
    expect(store.getState().selectedNodeId).toBeNull();

    store.getState().undo();
    expect(store.getState().document).toEqual(edited);
    expect(store.getState().selectedNodeId).toBeNull();
  });
});

describe('import and export', () => {
  it('round-trips only the graph document', () => {
    const store = makeStore();
    store.getState().selectNode('field');
    store.getState().setPlaying(false);
    store.getState().moveNode('field', { x: 99, y: 101 });

    const json = store.getState().exportProject();
    const raw = JSON.parse(json) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(['edges', 'nodes', 'schemaVersion']);
    expect(parseGraphDocument(json)).toEqual(store.getState().document);
  });

  it('does not replace the project when import validation fails', () => {
    const store = makeStore();
    const before = store.getState().document;
    const result = store.getState().importProject('{"schemaVersion": 999}');

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected the import to fail.');
    }
    expect(result.error).toContain('Unsupported schema version');
    expect(store.getState().document).toBe(before);
    expect(store.getState().canUndo).toBe(false);
  });

  it('does not replace the project when imported topology is invalid', () => {
    const store = makeStore();
    const before = store.getState().document;
    const imported = connectionFixture();
    imported.edges = [
      {
        id: 'wave-a-wave-b',
        source: { nodeId: 'wave-a', portId: 'value' },
        target: { nodeId: 'wave-b', portId: 'phase' },
      },
      {
        id: 'wave-b-wave-a',
        source: { nodeId: 'wave-b', portId: 'value' },
        target: { nodeId: 'wave-a', portId: 'phase' },
      },
    ];

    const result = store.getState().importProject(JSON.stringify(imported));

    expect(result).toMatchObject({ ok: false });
    expect(store.getState().document).toBe(before);
    expect(store.getState().canUndo).toBe(false);
  });

  it('rejects oversized and schema-invalid imports transactionally', () => {
    const store = makeStore();
    const before = store.getState().document;

    expect(
      store.getState().importProject(' '.repeat(MAX_GRAPH_JSON_BYTES + 1)),
    ).toMatchObject({ ok: false });

    const invalid = cloneGraphDocument(DEFAULT_GRAPH);
    const field = invalid.nodes.find(({ id }) => id === 'field');
    if (!field) {
      throw new Error('Fixture node is missing.');
    }
    field.params.scale = 99;
    expect(store.getState().importProject(invalid)).toMatchObject({ ok: false });
    expect(store.getState().document).toBe(before);
    expect(store.getState().canUndo).toBe(false);
  });

  it('canonicalizes omitted imported parameters with defaults', () => {
    const store = makeStore();
    const imported = cloneGraphDocument(DEFAULT_GRAPH);
    const field = imported.nodes.find(({ id }) => id === 'field');
    if (!field) {
      throw new Error('Fixture node is missing.');
    }
    field.params = { scale: 8 };

    expect(store.getState().importProject(imported)).toEqual({ ok: true });
    expect(
      store.getState().document.nodes.find(({ id }) => id === 'field')?.params,
    ).toEqual({ scale: 8, speed: 0.35, energy: 0.35, hue: 0.08 });
  });

  it('imports a parsed project and makes the replacement undoable', () => {
    const store = makeStore();
    const imported = cloneGraphDocument(DEFAULT_GRAPH);
    const field = imported.nodes.find(({ id }) => id === 'field');
    if (!field) {
      throw new Error('Fixture node is missing.');
    }
    field.position = { x: 444, y: 555 };

    expect(store.getState().importProject(JSON.stringify(imported))).toEqual({ ok: true });
    expect(
      store.getState().document.nodes.find(({ id }) => id === 'field')?.position,
    ).toEqual({ x: 444, y: 555 });
    store.getState().undo();
    expect(store.getState().document).toEqual(DEFAULT_GRAPH);
  });
});

describe('persistence integration', () => {
  it('autosaves a versioned graph without session or history state', () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const store = makeStore({
      storage,
      storageKey: 'project',
      autosaveDelayMs: 20,
    });
    store.getState().selectNode('field');
    store.getState().setPlaying(false);
    store.getState().setNodeParam('field', 'scale', 9);

    expect(storage.getItem('project')).toBeNull();
    expect(store.getState().persistenceState).toBe('pending');
    vi.advanceTimersByTime(20);
    expect(store.getState().persistenceState).toBe('saved');
    const raw = storage.getItem('project');
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(['document', 'storageVersion']);
    expect(stored.storageVersion).toBe(PROJECT_STORAGE_VERSION);
    expect(stored).not.toHaveProperty('selectedNodeId');
    expect(stored).not.toHaveProperty('playing');
    expect(stored).not.toHaveProperty('canUndo');
  });

  it('flushes the latest pending edit synchronously', () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const store = makeStore({
      storage,
      storageKey: 'project',
      autosaveDelayMs: 1_000,
    });

    store.getState().setNodeParam('field', 'scale', 13);
    expect(store.getState().persistenceState).toBe('pending');
    expect(store.flushPersistence()).toBe(true);
    expect(store.getState().persistenceState).toBe('saved');

    const saved = loadStoredProject(storage, 'project');
    expect(
      saved.nodes.find(({ id }) => id === 'field')?.params.scale,
    ).toBe(13);
  });

  it('reports a failed local save', () => {
    vi.useFakeTimers();
    const storage: ProjectStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    };
    const store = makeStore({
      storage,
      storageKey: 'project',
      autosaveDelayMs: 20,
    });

    store.getState().setNodeParam('field', 'scale', 12);
    expect(store.getState().persistenceState).toBe('pending');
    vi.advanceTimersByTime(20);
    expect(store.getState().persistenceState).toBe('failed');
    expect(store.flushPersistence()).toBe(false);
    expect(store.getState().persistenceState).toBe('failed');
  });

  it('loads an autosaved document into a fresh isolated store', () => {
    const storage = new MemoryStorage();
    const first = makeStore({ storage, storageKey: 'project' });
    first.getState().setNodeParam('field', 'scale', 12);
    expect(first.flushPersistence()).toBe(true);

    const second = makeStore({ storage, storageKey: 'project' });
    expect(
      second.getState().document.nodes.find(({ id }) => id === 'field')?.params.scale,
    ).toBe(12);
    expect(second.getState()).toMatchObject({
      selectedNodeId: null,
      playing: true,
      canUndo: false,
      canRedo: false,
      persistenceState: 'saved',
    });
  });
});
