import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultParams } from '../graph';
import { TextFrameCache } from './TextFrameCache';

describe('text frame cache', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(document, 'fonts'); });

  function setup() {
    const context = { font: '', textBaseline: '', textAlign: '', fillStyle: '', measureText: (text: string) => ({ width: text.length * 10 }), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), fillText: vi.fn<(text: string, x: number, y: number) => void>() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => context) as unknown as HTMLCanvasElement['getContext']);
    return { cache: new TextFrameCache(vi.fn()), context, params: getDefaultParams('text') };
  }

  it('reuses unchanged rasters, updates text, and releases inactive canvases', () => {
    const { cache, context, params } = setup();
    const frame = cache.get('text', params, 512, 512);
    expect(context.fillText).toHaveBeenCalledWith('VideoBrain', 256, 256);
    frame.dirty = false;
    cache.get('text', params, 512, 512);
    expect(context.fillText).toHaveBeenCalledOnce();
    expect(frame.dirty).toBe(false);
    cache.get('text', { ...params, text: 'Live' }, 512, 512);
    expect(context.fillText).toHaveBeenLastCalledWith('Live', 256, 256);
    cache.markDirty();
    expect(frame.dirty).toBe(true);
    cache.retain(new Set());
    expect(frame.image.width).toBe(0);
  });

  it('applies alignment, wrapping, alpha, and clipping in output coordinates', () => {
    const { cache, context, params } = setup();
    cache.get('text', { ...params, text: 'one two three', width: 0.1, align: 'left', verticalAlign: 'top', alpha: 0.3 }, 512, 512);
    expect(context.fillText.mock.calls.map(([line]) => line)).toEqual(['one', 'two', 'three']);
    expect(context.textAlign).toBe('left');
    expect(context.fillStyle).toContain('0.3');
    expect(context.clip).toHaveBeenCalledOnce();
  });

  it('ignores late font loads and removes registered fonts when disposed', async () => {
    const pending: (() => void)[] = [];
    const add = vi.fn();
    const remove = vi.fn();
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add, delete: remove } });
    vi.stubGlobal('FontFace', class {
      constructor(readonly family: string) {}
      load() { return new Promise<void>((resolve) => pending.push(resolve)); }
    });
    const { cache, params } = setup();
    const fontParams = { ...params, fontFamily: 'custom', fontAsset: `data:font/woff2;base64,${btoa('wOF2font')}` };
    cache.get('text', fontParams, 512, 512);
    cache.clear();
    pending[0]?.();
    await Promise.resolve();
    expect(add).not.toHaveBeenCalled();
    const frame = cache.get('text', fontParams, 512, 512);
    pending[1]?.();
    await Promise.resolve();
    expect(frame.ready).toBe(true);
    expect(add).toHaveBeenCalledOnce();
    cache.clear();
    expect(remove).toHaveBeenCalledTimes(2);
  });
});