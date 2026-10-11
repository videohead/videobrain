import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileGraph, createGraphNode, GRAPH_SCHEMA_VERSION, type NodeKind } from '../graph';
import { DataSessions, dataUrl } from './DataSessions';

function setup(kind: NodeKind, params = {}) {
  const sessions = new DataSessions();
  const plan = compileGraph({ schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [createGraphNode(kind, { x: 0, y: 0 }, params, 'source'), createGraphNode('dataInspect', { x: 300, y: 0 }, {}, 'inspect')],
    edges: [{ id: 'wire', source: { nodeId: 'source', portId: 'text' }, target: { nodeId: 'inspect', portId: 'text' } }],
  });
  sessions.reconcile(plan);
  return sessions;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear(); });

describe('explicit data sessions', () => {
  it('validates schemes and credentials without requests', () => {
    expect(dataUrl('https://example.test/data')).toBe('https://example.test/data');
    expect(() => dataUrl('http://remote.test/data')).toThrow();
    expect(() => dataUrl('https://user:secret@example.test')).toThrow();
    expect(() => dataUrl('javascript:alert(1)')).toThrow();
    expect(() => dataUrl('https://example.test', true)).toThrow();
  });
  it('fetches only on action and bounds streaming responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('hello', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const sessions = setup('httpFetch', { url: 'https://example.test/data' });
    expect(fetchMock).not.toHaveBeenCalled();
    await sessions.action('source', 'start');
    expect(sessions.snapshot('source')).toMatchObject({ text: 'hello', status: 200, active: false });
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/data', expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
    sessions.dispose();
    const large = setup('httpFetch', { url: 'https://example.test/data' });
    fetchMock.mockResolvedValue(new Response('x'.repeat(32769)));
    await large.action('source', 'start');
    expect(large.snapshot('source').error).toContain('32 KiB');
    expect(large.snapshot('source').text).toBe('');
    large.dispose();
  });
  it('ignores late responses after stop or becoming unreachable', async () => {
    let resolve: (value: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    const sessions = setup('httpFetch', { url: 'https://example.test/data' });
    const pending = sessions.action('source', 'start');
    sessions.reconcile(null);
    resolve(new Response('late'));
    await pending;
    expect(sessions.snapshot('source').text).toBe('');
    expect(sessions.snapshot('source').active).toBe(false);
    sessions.dispose();
  });
  it('isolates storage and requires explicit write/read/delete actions', async () => {
    vi.useFakeTimers();
    localStorage.setItem('videobrain.project', 'untouched');
    const sessions = setup('dataStorage', { key: 'fixture', text: 'saved' });
    expect(localStorage.getItem('videobrain.data.v1.fixture')).toBeNull();
    await sessions.action('source', 'write');
    expect(localStorage.getItem('videobrain.data.v1.fixture')).toBe('saved');
    await vi.advanceTimersByTimeAsync(250);
    await sessions.action('source', 'delete');
    expect(localStorage.getItem('videobrain.data.v1.fixture')).toBeNull();
    expect(localStorage.getItem('videobrain.project')).toBe('untouched');
    sessions.dispose();
  });
  it('rejects writes from an inactive node', async () => {
    const sessions = new DataSessions();
    await sessions.action('missing', 'write');
    expect(sessions.snapshot('missing').error).toContain('Connect');
    sessions.dispose();
  });
});