import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GRAPH,
  MAX_GRAPH_JSON_BYTES,
  cloneGraphDocument,
} from '../graph';
import {
  PROJECT_STORAGE_VERSION,
  loadStoredProject,
  saveStoredProject,
  type ProjectStorage,
} from './persistence';

class MemoryStorage implements ProjectStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('project persistence', () => {
  it('falls back to a fresh default when data is absent or corrupted', () => {
    const storage = new MemoryStorage();
    const missing = loadStoredProject(storage, 'project');
    expect(missing).toEqual(DEFAULT_GRAPH);
    expect(missing).not.toBe(DEFAULT_GRAPH);

    storage.setItem('project', '{broken');
    const corrupted = loadStoredProject(storage, 'project');
    expect(corrupted).toEqual(DEFAULT_GRAPH);
    expect(corrupted).not.toBe(DEFAULT_GRAPH);
  });

  it('falls back when the storage envelope version is unsupported', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'project',
      JSON.stringify({ storageVersion: PROJECT_STORAGE_VERSION + 1, document: DEFAULT_GRAPH }),
    );

    expect(loadStoredProject(storage, 'project')).toEqual(DEFAULT_GRAPH);
  });

  it('falls back when a stored graph is structurally valid but cannot compile', () => {
    const storage = new MemoryStorage();
    const document = cloneGraphDocument(DEFAULT_GRAPH);
    document.edges.push({
      id: 'missing-source',
      source: { nodeId: 'missing', portId: 'frame' },
      target: { nodeId: 'display', portId: 'source' },
    });
    storage.setItem(
      'project',
      JSON.stringify({ storageVersion: PROJECT_STORAGE_VERSION, document }),
    );

    expect(loadStoredProject(storage, 'project')).toEqual(DEFAULT_GRAPH);
  });

  it('falls back before parsing an oversized storage value', () => {
    const storage = new MemoryStorage();
    storage.setItem('project', ' '.repeat(MAX_GRAPH_JSON_BYTES + 1));

    const loaded = loadStoredProject(storage, 'project');
    expect(loaded).toEqual(DEFAULT_GRAPH);
    expect(loaded).not.toBe(DEFAULT_GRAPH);
  });

  it('falls back when stored parameters violate their operator schema', () => {
    const storage = new MemoryStorage();
    const document = cloneGraphDocument(DEFAULT_GRAPH);
    const field = document.nodes.find(({ id }) => id === 'field');
    if (!field) {
      throw new Error('Fixture node is missing.');
    }
    field.params.scale = 99;
    storage.setItem(
      'project',
      JSON.stringify({ storageVersion: PROJECT_STORAGE_VERSION, document }),
    );

    expect(loadStoredProject(storage, 'project')).toEqual(DEFAULT_GRAPH);
  });

  it('loads and saves a validated graph document', () => {
    const storage = new MemoryStorage();
    const document = cloneGraphDocument(DEFAULT_GRAPH);
    const field = document.nodes.find(({ id }) => id === 'field');
    if (!field) {
      throw new Error('Fixture node is missing.');
    }
    field.params.scale = 13;

    expect(saveStoredProject(storage, document, 'project')).toBe(true);
    expect(loadStoredProject(storage, 'project')).toEqual(document);
  });

  it('contains storage access failures and returns safe fallbacks', () => {
    const throwingStorage: ProjectStorage = {
      getItem: () => {
        throw new Error('read denied');
      },
      setItem: () => {
        throw new Error('write denied');
      },
    };

    expect(loadStoredProject(throwingStorage, 'project')).toEqual(DEFAULT_GRAPH);
    expect(saveStoredProject(throwingStorage, DEFAULT_GRAPH, 'project')).toBe(false);
  });

  it('does not overwrite storage when a document is invalid', () => {
    const storage = new MemoryStorage();
    storage.setItem('project', 'existing');
    const invalid = cloneGraphDocument(DEFAULT_GRAPH);
    const field = invalid.nodes.find(({ id }) => id === 'field');
    if (!field) {
      throw new Error('Fixture node is missing.');
    }
    field.params.scale = 99;

    expect(saveStoredProject(storage, invalid, 'project')).toBe(false);
    expect(storage.getItem('project')).toBe('existing');
  });
});
