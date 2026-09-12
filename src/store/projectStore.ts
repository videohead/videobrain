import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  DEFAULT_GRAPH,
  MAX_GRAPH_NODES,
  cloneGraphDocument,
  compileGraph,
  createGraphNode,
  normalizeNodeParams,
  parseGraphDocument,
  serializeGraphDocument,
  validateConnection,
  type ConnectionValidation,
  type GraphDocument,
  type GraphEndpoint,
  type GraphParamValue,
  type GraphParams,
  type GraphPosition,
  type NodeKind,
} from '../graph';
import {
  PROJECT_STORAGE_KEY,
  getBrowserProjectStorage,
  loadStoredProject,
  saveStoredProject,
  type ProjectStorage,
} from './persistence';

const DEFAULT_HISTORY_LIMIT = 100;
const DEFAULT_AUTOSAVE_DELAY_MS = 250;

let generatedEdgeId = 0;

export type ProjectImportResult =
  | { ok: true }
  | { ok: false; error: string };

export type PersistenceState = 'saved' | 'pending' | 'failed';

export interface ProjectStoreState {
  document: GraphDocument;
  selectedNodeId: string | null;
  playing: boolean;
  canUndo: boolean;
  canRedo: boolean;
  persistenceState: PersistenceState;
  addNode: (
    kind: NodeKind,
    position: GraphPosition,
    params?: GraphParams,
  ) => string;
  deleteNode: (nodeId: string) => void;
  moveNode: (nodeId: string, position: GraphPosition) => void;
  setNodeParam: (
    nodeId: string,
    paramId: string,
    value: GraphParamValue,
  ) => void;
  connect: (
    source: GraphEndpoint,
    target: GraphEndpoint,
  ) => ConnectionValidation;
  disconnect: (edgeId: string) => void;
  selectNode: (nodeId: string | null) => void;
  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  beginGesture: () => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  resetProject: () => void;
  importProject: (value: unknown) => ProjectImportResult;
  exportProject: () => string;
}

export interface CreateProjectStoreOptions {
  initialDocument?: GraphDocument;
  storage?: ProjectStorage | null;
  storageKey?: string;
  autosaveDelayMs?: number;
  historyLimit?: number;
}

export interface ProjectStoreApi extends StoreApi<ProjectStoreState> {
  flushPersistence: () => boolean;
  dispose: () => void;
}

function isFinitePosition(position: GraphPosition): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y);
}

function isValidParamValue(value: GraphParamValue): boolean {
  return typeof value !== 'number' || Number.isFinite(value);
}

function nextEdgeId(document: GraphDocument): string {
  let candidate: string;
  do {
    generatedEdgeId += 1;
    const randomId = globalThis.crypto?.randomUUID?.();
    candidate = randomId
      ? `edge-${randomId}`
      : `edge-${Date.now().toString(36)}-${generatedEdgeId.toString(36)}`;
  } while (document.edges.some((edge) => edge.id === candidate));
  return candidate;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The project could not be imported.';
}

export function createProjectStore(
  options: CreateProjectStoreOptions = {},
): ProjectStoreApi {
  const storage =
    options.storage === undefined
      ? getBrowserProjectStorage()
      : options.storage;
  const storageKey = options.storageKey ?? PROJECT_STORAGE_KEY;
  const historyLimit = Math.max(
    1,
    Math.floor(options.historyLimit ?? DEFAULT_HISTORY_LIMIT),
  );
  const autosaveDelayMs = Math.max(
    0,
    options.autosaveDelayMs ?? DEFAULT_AUTOSAVE_DELAY_MS,
  );
  const initialDocument = options.initialDocument
    ? compileGraph(parseGraphDocument(options.initialDocument)).document
    : loadStoredProject(storage, storageKey);

  const past: GraphDocument[] = [];
  const future: GraphDocument[] = [];
  let gestureStart: GraphDocument | null = null;
  let gestureRecorded = false;

  const pushPast = (document: GraphDocument): void => {
    past.push(cloneGraphDocument(document));
    if (past.length > historyLimit) {
      past.splice(0, past.length - historyLimit);
    }
  };

  const closeGesture = (): void => {
    gestureStart = null;
    gestureRecorded = false;
  };

  const baseStore = createStore<ProjectStoreState>()((set, get) => {
    const commitDocument = (
      document: GraphDocument,
      coalesceGesture = false,
      selectedNodeId: string | null = get().selectedNodeId,
    ): void => {
      if (coalesceGesture && gestureStart) {
        if (!gestureRecorded) {
          pushPast(gestureStart);
          future.length = 0;
          gestureRecorded = true;
        }
      } else {
        closeGesture();
        pushPast(get().document);
        future.length = 0;
      }

      set({
        document,
        selectedNodeId,
        canUndo: past.length > 0,
        canRedo: false,
      });
    };

    return {
      document: cloneGraphDocument(initialDocument),
      selectedNodeId: null,
      playing: true,
      canUndo: false,
      canRedo: false,
      persistenceState: storage ? 'saved' : 'failed',

      addNode: (kind, position, params = {}) => {
        if (!isFinitePosition(position)) {
          throw new TypeError('Node position must contain finite coordinates.');
        }
        if (!Object.values(params).every(isValidParamValue)) {
          throw new TypeError('Numeric parameters must be finite.');
        }
        const state = get();
        if (state.document.nodes.length >= MAX_GRAPH_NODES) {
          throw new RangeError(
            `Graph has reached the ${MAX_GRAPH_NODES}-node limit.`,
          );
        }
        let node = createGraphNode(kind, position, params);
        while (state.document.nodes.some(({ id }) => id === node.id)) {
          node = createGraphNode(kind, position, params);
        }
        commitDocument({
          ...state.document,
          nodes: [...state.document.nodes, node],
        });
        return node.id;
      },

      deleteNode: (nodeId) => {
        const state = get();
        if (!state.document.nodes.some((node) => node.id === nodeId)) {
          return;
        }
        commitDocument(
          {
            ...state.document,
            nodes: state.document.nodes.filter((node) => node.id !== nodeId),
            edges: state.document.edges.filter(
              (edge) =>
                edge.source.nodeId !== nodeId && edge.target.nodeId !== nodeId,
            ),
          },
          false,
          state.selectedNodeId === nodeId ? null : state.selectedNodeId,
        );
      },

      moveNode: (nodeId, position) => {
        if (!isFinitePosition(position)) {
          throw new TypeError('Node position must contain finite coordinates.');
        }
        const state = get();
        const node = state.document.nodes.find((candidate) => candidate.id === nodeId);
        if (
          !node ||
          (node.position.x === position.x && node.position.y === position.y)
        ) {
          return;
        }
        commitDocument(
          {
            ...state.document,
            nodes: state.document.nodes.map((candidate) =>
              candidate.id === nodeId
                ? { ...candidate, position: { ...position } }
                : candidate,
            ),
          },
          true,
        );
      },

      setNodeParam: (nodeId, paramId, value) => {
        if (!isValidParamValue(value)) {
          throw new TypeError('Numeric parameters must be finite.');
        }
        const state = get();
        const node = state.document.nodes.find((candidate) => candidate.id === nodeId);
        if (!node || Object.is(node.params[paramId], value)) {
          return;
        }
        const params = normalizeNodeParams(
          node.kind,
          { ...node.params, [paramId]: value },
          `node "${nodeId}" parameters`,
        );
        commitDocument(
          {
            ...state.document,
            nodes: state.document.nodes.map((candidate) =>
              candidate.id === nodeId
                  ? {
                    ...candidate,
                    params,
                  }
                : candidate,
            ),
          },
          true,
        );
      },

      connect: (source, target) => {
        const state = get();
        const validation = validateConnection(state.document, source, target);
        if (!validation.valid) {
          return validation;
        }
        commitDocument({
          ...state.document,
          edges: [
            ...state.document.edges,
            {
              id: nextEdgeId(state.document),
              source: { ...source },
              target: { ...target },
            },
          ],
        });
        return validation;
      },

      disconnect: (edgeId) => {
        const state = get();
        if (!state.document.edges.some((edge) => edge.id === edgeId)) {
          return;
        }
        commitDocument({
          ...state.document,
          edges: state.document.edges.filter((edge) => edge.id !== edgeId),
        });
      },

      selectNode: (nodeId) => {
        const document = get().document;
        const selection =
          nodeId === null || document.nodes.some((node) => node.id === nodeId)
            ? nodeId
            : null;
        set({ selectedNodeId: selection });
      },

      setPlaying: (playing) => {
        set({ playing });
      },

      togglePlaying: () => {
        set((state) => ({ playing: !state.playing }));
      },

      beginGesture: () => {
        if (!gestureStart) {
          gestureStart = cloneGraphDocument(get().document);
          gestureRecorded = false;
        }
      },

      endGesture: () => {
        closeGesture();
      },

      undo: () => {
        closeGesture();
        const previous = past.pop();
        if (!previous) {
          return;
        }
        const state = get();
        future.push(cloneGraphDocument(state.document));
        const selectedNodeId =
          state.selectedNodeId &&
          previous.nodes.some((node) => node.id === state.selectedNodeId)
            ? state.selectedNodeId
            : null;
        set({
          document: cloneGraphDocument(previous),
          selectedNodeId,
          canUndo: past.length > 0,
          canRedo: true,
        });
      },

      redo: () => {
        closeGesture();
        const next = future.pop();
        if (!next) {
          return;
        }
        const state = get();
        pushPast(state.document);
        const selectedNodeId =
          state.selectedNodeId &&
          next.nodes.some((node) => node.id === state.selectedNodeId)
            ? state.selectedNodeId
            : null;
        set({
          document: cloneGraphDocument(next),
          selectedNodeId,
          canUndo: true,
          canRedo: future.length > 0,
        });
      },

      resetProject: () => {
        commitDocument(cloneGraphDocument(DEFAULT_GRAPH), false, null);
      },

      importProject: (value) => {
        try {
          const document = compileGraph(parseGraphDocument(value)).document;
          commitDocument(document, false, null);
          return { ok: true };
        } catch (error) {
          return { ok: false, error: errorMessage(error) };
        }
      },

      exportProject: () => serializeGraphDocument(get().document),
    };
  });

  let persistenceTimer: ReturnType<typeof setTimeout> | undefined;

  const flushPersistence = (): boolean => {
    if (persistenceTimer !== undefined) {
      clearTimeout(persistenceTimer);
      persistenceTimer = undefined;
    }
    const saved = saveStoredProject(
      storage,
      baseStore.getState().document,
      storageKey,
    );
    baseStore.setState({ persistenceState: saved ? 'saved' : 'failed' });
    return saved;
  };

  const unsubscribe = baseStore.subscribe((state, previousState) => {
    if (state.document === previousState.document) {
      return;
    }
    if (!storage) {
      baseStore.setState({ persistenceState: 'failed' });
      return;
    }
    if (persistenceTimer !== undefined) {
      clearTimeout(persistenceTimer);
    }
    baseStore.setState({ persistenceState: 'pending' });
    persistenceTimer = setTimeout(() => {
      persistenceTimer = undefined;
      const saved = saveStoredProject(
        storage,
        baseStore.getState().document,
        storageKey,
      );
      baseStore.setState({ persistenceState: saved ? 'saved' : 'failed' });
    }, autosaveDelayMs);
  });

  return Object.assign(baseStore, {
    flushPersistence,
    dispose: () => {
      unsubscribe();
      if (persistenceTimer !== undefined) {
        clearTimeout(persistenceTimer);
        persistenceTimer = undefined;
      }
    },
  });
}
