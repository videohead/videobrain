import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VECTOR_ARTWORK } from '../graph/vectorArtwork';
import { SvgFrameCache } from './SvgFrameCache';

describe('SVG frame cache', () => {
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    const images: HTMLImageElement[] = [];
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor() {
          images.push(this as unknown as HTMLImageElement);
        }
      },
    );
    const onReady = vi.fn();
    return { images, onReady, cache: new SvgFrameCache(onReady) };
  }

  it('decodes once, reuses unchanged artwork, and marks reset textures dirty', () => {
    const { cache, images, onReady } = setup();
    expect(cache.get('art', DEFAULT_VECTOR_ARTWORK, 640, 360)).toBeNull();
    images[0]?.dispatchEvent?.(new Event('load'));
    images[0]?.onload?.(new Event('load'));
    const frame = cache.get('art', DEFAULT_VECTOR_ARTWORK, 640, 360);
    expect(frame?.ready).toBe(true);
    expect(onReady).toHaveBeenCalledOnce();
    expect(images).toHaveLength(1);
    if (!frame) throw new Error('Missing decoded frame.');
    frame.dirty = false;
    expect(cache.get('art', DEFAULT_VECTOR_ARTWORK, 640, 360)?.dirty).toBe(
      false,
    );
    cache.markDirty();
    expect(frame.dirty).toBe(true);
    cache.clear();
    expect(frame.image.src).toBe('');
  });

  it('cancels stale loads, regenerates on resize, and releases inactive nodes', () => {
    const { cache, images, onReady } = setup();
    cache.get('art', DEFAULT_VECTOR_ARTWORK, 640, 360);
    const staleLoad = images[0]?.onload;
    cache.get('art', DEFAULT_VECTOR_ARTWORK, 320, 180);
    staleLoad?.call(images[0]!, new Event('load'));
    expect(onReady).not.toHaveBeenCalled();
    expect(images[0]?.src).toBe('');
    expect(images).toHaveLength(2);
    cache.retain(new Set());
    expect(images[1]?.onload).toBeNull();
  });

  it('reports decoding failures and rejects unsafe artwork before decoding', () => {
    const { cache, images, onReady } = setup();
    cache.get('art', DEFAULT_VECTOR_ARTWORK, 640, 360);
    images[0]?.onerror?.(new Event('error'));
    expect(onReady).toHaveBeenCalledOnce();
    expect(() => cache.get('art', DEFAULT_VECTOR_ARTWORK, 640, 360)).toThrow(
      'decoded',
    );
    expect(() => cache.get('bad', '<svg/>', 640, 360)).toThrow();
    expect(images).toHaveLength(1);
  });
});
