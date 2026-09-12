import {
  DEFAULT_GRAPH,
  MAX_GRAPH_JSON_BYTES,
  cloneGraphDocument,
  compileGraph,
  parseGraphDocument,
  type GraphDocument,
} from '../graph';

export const PROJECT_STORAGE_VERSION = 1 as const;
export const PROJECT_STORAGE_KEY = 'videobrain.project';

export interface ProjectStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredProject {
  storageVersion: typeof PROJECT_STORAGE_VERSION;
  document: GraphDocument;
}

function fitsStorageLimit(value: string): boolean {
  return (
    value.length <= MAX_GRAPH_JSON_BYTES &&
    new TextEncoder().encode(value).byteLength <= MAX_GRAPH_JSON_BYTES
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getBrowserProjectStorage(): ProjectStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadStoredProject(
  storage: ProjectStorage | null,
  key = PROJECT_STORAGE_KEY,
  fallback: GraphDocument = DEFAULT_GRAPH,
): GraphDocument {
  if (!storage) {
    return cloneGraphDocument(fallback);
  }

  try {
    const raw = storage.getItem(key);
    if (raw === null) {
      return cloneGraphDocument(fallback);
    }
    if (!fitsStorageLimit(raw)) {
      return cloneGraphDocument(fallback);
    }

    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      value.storageVersion !== PROJECT_STORAGE_VERSION ||
      !('document' in value)
    ) {
      return cloneGraphDocument(fallback);
    }

    return compileGraph(parseGraphDocument(value.document)).document;
  } catch {
    return cloneGraphDocument(fallback);
  }
}

export function saveStoredProject(
  storage: ProjectStorage | null,
  document: GraphDocument,
  key = PROJECT_STORAGE_KEY,
): boolean {
  if (!storage) {
    return false;
  }

  try {
    const stored: StoredProject = {
      storageVersion: PROJECT_STORAGE_VERSION,
      document: compileGraph(parseGraphDocument(document)).document,
    };
    const serialized = JSON.stringify(stored);
    if (!fitsStorageLimit(serialized)) {
      return false;
    }
    storage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}
