import type { GraphParams } from '../graph/types';
import { decodeFontAsset } from '../graph/fontAsset';
import { wrapText } from './textLayout';

export const TEXT_FRAME_READY_EVENT = 'videobrain-text-frame-ready';

interface TextFrame {
  image: HTMLCanvasElement;
  key: string;
  asset: string;
  font: FontFace | null;
  error: Error | null;
  ready: boolean;
  dirty: boolean;
}

export class TextFrameCache {
  private frames = new Map<string, TextFrame>();
  private fontSequence = 0;

  constructor(private readonly onReady: () => void) {}

  get(nodeId: string, params: GraphParams, width: number, height: number): TextFrame {
    const asset = params.fontFamily === 'custom' ? String(params.fontAsset ?? '') : '';
    let frame = this.frames.get(nodeId);
    if (!frame || frame.asset !== asset) {
      this.remove(nodeId);
      frame = { image: document.createElement('canvas'), key: '', asset, font: null, error: null, ready: !asset, dirty: true };
      this.frames.set(nodeId, frame);
      if (asset) {
        const bytes = decodeFontAsset(asset);
        if (!bytes || typeof FontFace === 'undefined') throw new Error('Custom fonts are unavailable in this browser. Choose a built-in font.');
        const font = new FontFace(`VideoBrainText${++this.fontSequence}`, new Uint8Array(bytes).buffer);
        frame.font = font;
        const pending = frame;
        void font.load().then(() => {
          if (this.frames.get(nodeId) !== pending) return;
          document.fonts.add(font);
          pending.ready = true;
          pending.key = '';
          this.onReady();
        }).catch(() => {
          if (this.frames.get(nodeId) !== pending) return;
          pending.error = new Error('The embedded font could not be decoded. Replace it or choose a built-in font.');
          this.onReady();
        });
      }
    }
    if (frame.error) throw frame.error;
    const key = JSON.stringify([params, width, height, frame.ready]);
    if (frame.key !== key) {
      frame.image.width = width;
      frame.image.height = height;
      const context = frame.image.getContext('2d');
      if (!context) throw new Error('Canvas text rendering is unavailable.');
      const family = frame.font && frame.ready ? `"${frame.font.family}"` : params.fontFamily === 'custom' ? 'sans-serif' : String(params.fontFamily);
      const fontSize = Number(params.fontSize) * Math.min(width, height) / 512;
      const lineHeight = fontSize * Number(params.lineHeight);
      const boxWidth = width * Number(params.width);
      const boxHeight = height * Number(params.height);
      const left = width * Number(params.x) - boxWidth / 2;
      const top = height * (1 - Number(params.y)) - boxHeight / 2;
      context.font = `${String(params.fontWeight)} ${fontSize}px ${family}`;
      context.textBaseline = 'middle';
      context.textAlign = params.align === 'left' ? 'left' : params.align === 'right' ? 'right' : 'center';
      context.fillStyle = `rgba(${Number(params.red) * 255}, ${Number(params.green) * 255}, ${Number(params.blue) * 255}, ${Number(params.alpha)})`;
      const mode = params.wrap === 'none' ? 'none' : params.wrap === 'character' ? 'character' : 'word';
      const lines = wrapText(String(params.text), boxWidth, mode, (value) => context.measureText(value).width);
      const blockHeight = lines.length * lineHeight;
      const offset = params.verticalAlign === 'top' ? 0 : params.verticalAlign === 'bottom' ? boxHeight - blockHeight : (boxHeight - blockHeight) / 2;
      const anchor = params.align === 'left' ? left : params.align === 'right' ? left + boxWidth : left + boxWidth / 2;
      context.save();
      context.beginPath();
      context.rect(left, top, boxWidth, boxHeight);
      context.clip();
      lines.forEach((line, index) => context.fillText(line, anchor, top + offset + (index + 0.5) * lineHeight));
      context.restore();
      frame.key = key;
      frame.dirty = true;
    }
    return frame;
  }

  markDirty(): void {
    for (const frame of this.frames.values()) frame.dirty = true;
  }

  retain(nodeIds: ReadonlySet<string>): void {
    for (const nodeId of this.frames.keys()) if (!nodeIds.has(nodeId)) this.remove(nodeId);
  }

  clear(): void {
    for (const nodeId of this.frames.keys()) this.remove(nodeId);
  }

  private remove(nodeId: string): void {
    const frame = this.frames.get(nodeId);
    if (!frame) return;
    this.frames.delete(nodeId);
    if (frame.font && typeof document.fonts?.delete === 'function') document.fonts.delete(frame.font);
    frame.image.width = 0;
    frame.image.height = 0;
  }
}