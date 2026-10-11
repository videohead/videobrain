import { vectorArtworkAtSize } from '../graph/vectorArtwork';

interface SvgFrame {
  artwork: string;
  width: number;
  height: number;
  image: HTMLImageElement;
  ready: boolean;
  dirty: boolean;
  error: Error | null;
}

export const VECTOR_FRAME_READY_EVENT = 'videobrain-vector-frame-ready';

export class SvgFrameCache {
  private frames = new Map<string, SvgFrame>();

  constructor(private readonly onReady: () => void) {}

  get(
    nodeId: string,
    artwork: string,
    width: number,
    height: number,
  ): SvgFrame | null {
    let frame = this.frames.get(nodeId);
    if (
      !frame ||
      frame.artwork !== artwork ||
      frame.width !== width ||
      frame.height !== height
    ) {
      const source = vectorArtworkAtSize(artwork, width, height);
      this.remove(nodeId);
      const image = new Image();
      const next: SvgFrame = {
        artwork,
        width,
        height,
        image,
        ready: false,
        dirty: true,
        error: null,
      };
      this.frames.set(nodeId, next);
      image.onload = () => {
        if (this.frames.get(nodeId) !== next) return;
        next.ready = true;
        this.onReady();
      };
      image.onerror = () => {
        if (this.frames.get(nodeId) !== next) return;
        next.error = new Error('The SVG artwork could not be decoded.');
        this.onReady();
      };
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
      frame = next;
    }
    if (frame.error) throw frame.error;
    return frame.ready ? frame : null;
  }

  markDirty(): void {
    for (const frame of this.frames.values()) frame.dirty = true;
  }

  retain(nodeIds: ReadonlySet<string>): void {
    for (const nodeId of this.frames.keys()) {
      if (!nodeIds.has(nodeId)) this.remove(nodeId);
    }
  }

  clear(): void {
    for (const nodeId of this.frames.keys()) this.remove(nodeId);
  }

  private remove(nodeId: string): void {
    const frame = this.frames.get(nodeId);
    if (!frame) return;
    this.frames.delete(nodeId);
    frame.image.onload = null;
    frame.image.onerror = null;
    frame.image.src = '';
  }
}
