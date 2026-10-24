/**
 * M3 (named outputs and persisted mapping baseline) — clean presentation window.
 *
 * Opens a separate window that shows only the composited output: no toolbar,
 * no handles, no application chrome. The Window Management API is used when
 * the browser offers it and the user grants permission, which allows an
 * output to be bound to a named screen. When it is unavailable or denied,
 * the window still opens and remains manually placeable, so mapping never
 * depends on a permission the user has not given.
 *
 * Screen binding records the screen a user chose. It does not guarantee
 * physical placement, refresh alignment, or frame lock.
 */
import type { OutputLayout } from '../store/contracts';
import { MAX_OUTPUT_DIMENSION } from './surfaceLayout';

/** Minimal shape of a Window Management screen record. */
export interface ScreenBinding {
  /** Stable label reported by the platform, or a generated fallback. */
  id: string;
  label: string;
  width: number;
  height: number;
  left: number;
  top: number;
  isPrimary: boolean;
  isInternal: boolean;
}

export type ScreenAccess =
  | { state: 'unsupported' }
  | { state: 'denied'; reason: string }
  | { state: 'granted'; screens: readonly ScreenBinding[] };

interface ScreenDetailed {
  label?: unknown;
  width?: unknown;
  height?: unknown;
  left?: unknown;
  top?: unknown;
  isPrimary?: unknown;
  isInternal?: unknown;
}

interface ScreenDetails {
  screens?: readonly ScreenDetailed[];
}

/** The slice of `window` this module needs, so tests can supply a stub. */
export interface PresentationHost {
  open: (
    url: string,
    target: string,
    features: string,
  ) => PresentationTarget | null;
  getScreenDetails?: () => Promise<ScreenDetails>;
}

export interface PresentationTarget {
  closed: boolean;
  close: () => void;
  focus?: () => void;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  document?: {
    title?: string;
    body?: { innerHTML?: string } | null;
    write?: (markup: string) => void;
    close?: () => void;
    querySelector?: (selector: string) => Element | null;
  };
}

export interface PresentationMirror {
  stop: () => void;
}

function presentationDiagnosticsEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return (
    window.localStorage.getItem('videobrain.debugRenderer') === '1' ||
    new URLSearchParams(window.location.search).has('debugRenderer')
  );
}

function logPresentationDiagnostic(
  event: string,
  details: Record<string, unknown> = {},
): void {
  if (!presentationDiagnosticsEnabled()) {
    return;
  }
  console.info('[VideoBrain presentation]', {
    event,
    timeMs: Math.round(performance.now()),
    ...details,
  });
}

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** True when the browser exposes the Window Management API at all. */
export const supportsScreenPlacement = (host: PresentationHost): boolean =>
  typeof host.getScreenDetails === 'function';

/**
 * Requests screen details. Permission denial is a reported state, never a
 * thrown error, because manual placement remains a usable path.
 */
export async function requestScreens(
  host: PresentationHost,
): Promise<ScreenAccess> {
  if (!supportsScreenPlacement(host) || !host.getScreenDetails) {
    return { state: 'unsupported' };
  }
  try {
    const details = await host.getScreenDetails();
    const screens = (details.screens ?? []).map((screen, index) => {
      const label =
        typeof screen.label === 'string' && screen.label.length > 0
          ? screen.label
          : `Screen ${index + 1}`;
      return {
        id: `${index}:${label}`,
        label,
        width: numberOr(screen.width, 0),
        height: numberOr(screen.height, 0),
        left: numberOr(screen.left, 0),
        top: numberOr(screen.top, 0),
        isPrimary: screen.isPrimary === true,
        isInternal: screen.isInternal === true,
      } satisfies ScreenBinding;
    });
    return { state: 'granted', screens };
  } catch (error) {
    return {
      state: 'denied',
      reason:
        error instanceof Error
          ? error.message
          : 'Screen placement permission was refused.',
    };
  }
}

export type PresentationOpenResult =
  | { ok: true; session: PresentationSession }
  | { ok: false; error: string };

export interface PresentationSession {
  outputId: string;
  target: PresentationTarget;
  /** The screen this output was bound to, when one was chosen. */
  screen: ScreenBinding | null;
  /** True once the window has been closed, by us or by the user. */
  readonly lost: boolean;
}

/** Window features for a clean, chrome-free presentation surface. */
export function presentationFeatures(
  output: OutputLayout,
  screen: ScreenBinding | null,
): string {
  const width = Math.min(output.width, MAX_OUTPUT_DIMENSION);
  const height = Math.min(output.height, MAX_OUTPUT_DIMENSION);
  const left = (screen?.left ?? 0) + output.layoutX;
  const top = (screen?.top ?? 0) + output.layoutY;
  return [
    'popup=yes',
    'menubar=no',
    'toolbar=no',
    'location=no',
    'status=no',
    `width=${Math.round(width)}`,
    `height=${Math.round(height)}`,
    `left=${Math.round(left)}`,
    `top=${Math.round(top)}`,
  ].join(',');
}

/**
 * Opens a presentation window for one output. A blocked popup is reported
 * rather than thrown, because it is an ordinary browser outcome the user
 * can resolve.
 */
export function openPresentation(
  host: PresentationHost,
  output: OutputLayout,
  screen: ScreenBinding | null = null,
): PresentationOpenResult {
  if (output.width < 1 || output.height < 1) {
    return { ok: false, error: `Output "${output.name}" has no area.` };
  }
  let target: PresentationTarget | null = null;
  try {
    target = host.open('', `videobrain-output-${output.id}`, presentationFeatures(output, screen));
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'The presentation window could not be opened.',
    };
  }
  if (!target) {
    return {
      ok: false,
      error: 'The presentation window was blocked by the browser.',
    };
  }
  if (target.document) {
    target.document.title = `VideoBrain — ${output.name}`;
    writePresentationShell(target.document, output);
  }
  const session: PresentationSession = {
    outputId: output.id,
    target,
    screen,
    get lost() {
      return target?.closed === true;
    },
  };
  return { ok: true, session };
}

function presentationShell(output: OutputLayout): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>VideoBrain — ${escapeHtml(output.name)}</title>
    <style>
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #000; }
      body { display: grid; place-items: stretch; }
      canvas { width: 100vw; height: 100vh; display: block; object-fit: contain; background: #000; }
      .status { position: fixed; inset: 0; display: grid; place-items: center; color: #9299a7; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: #000; }
      .status[hidden] { display: none; }
    </style>
  </head>
  <body>
    <canvas id="videobrain-presentation-canvas" aria-label="VideoBrain output"></canvas>
    <div id="videobrain-presentation-status" class="status">Waiting for Display…</div>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  }[character] ?? character));
}

function writePresentationShell(
  document: NonNullable<PresentationTarget['document']>,
  output: OutputLayout,
): void {
  const markup = presentationShell(output);
  if (document.write) {
    document.write(markup);
    document.close?.();
    return;
  }
  if (document.body) {
    document.body.innerHTML = markup;
  }
}

export function mirrorPresentationCanvas(
  session: PresentationSession,
  source: HTMLCanvasElement | null,
  output: OutputLayout,
): PresentationMirror {
  const document = session.target.document;
  if (!document || !source) {
    logPresentationDiagnostic('mirror-unavailable', {
      outputId: session.outputId,
      hasDocument: Boolean(document),
      hasSource: Boolean(source),
    });
    return { stop: () => undefined };
  }

  const canvas = document.querySelector?.('#videobrain-presentation-canvas');
  const status = document.querySelector?.('#videobrain-presentation-status');
  if (canvas?.tagName.toLowerCase() !== 'canvas') {
    logPresentationDiagnostic('mirror-missing-canvas', { outputId: session.outputId });
    return { stop: () => undefined };
  }
  const targetCanvas = canvas as HTMLCanvasElement;
  const statusElement = status as HTMLElement | null;
  const context = targetCanvas.getContext('2d');
  if (!context) {
    logPresentationDiagnostic('mirror-context-error', { outputId: session.outputId });
    return { stop: () => undefined };
  }

  targetCanvas.width = Math.max(1, Math.round(Math.min(output.width, MAX_OUTPUT_DIMENSION)));
  targetCanvas.height = Math.max(1, Math.round(Math.min(output.height, MAX_OUTPUT_DIMENSION)));
  logPresentationDiagnostic('mirror-start', {
    outputId: session.outputId,
    width: targetCanvas.width,
    height: targetCanvas.height,
    sourceWidth: source.width,
    sourceHeight: source.height,
  });
  let stopped = false;
  let frame = 0;
  let drawCount = 0;
  const schedule = session.target.requestAnimationFrame?.bind(session.target) ?? globalThis.requestAnimationFrame.bind(globalThis);
  const cancel = session.target.cancelAnimationFrame?.bind(session.target) ?? globalThis.cancelAnimationFrame.bind(globalThis);

  const draw = () => {
    if (stopped || session.lost) {
      return;
    }
    try {
      context.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      context.drawImage(source, 0, 0, targetCanvas.width, targetCanvas.height);
      if (statusElement) {
        statusElement.hidden = true;
      }
      drawCount += 1;
    } catch {
      if (statusElement) {
        statusElement.hidden = false;
        statusElement.textContent = 'Display unavailable';
      }
      logPresentationDiagnostic('mirror-draw-error', { outputId: session.outputId });
    }
    frame = schedule(draw);
  };
  draw();

  return {
    stop: () => {
      stopped = true;
      cancel(frame);
      logPresentationDiagnostic('mirror-stop', {
        outputId: session.outputId,
        drawCount,
      });
    },
  };
}

/** Closes a session. Safe to call when the user already closed the window. */
export function closePresentation(session: PresentationSession): void {
  try {
    if (!session.target.closed) {
      session.target.close();
    }
  } catch {
    // A window the browser already discarded is simply gone.
  }
}

/** Tracks open presentation sessions and drops any the user has closed. */
export class PresentationRegistry {
  private readonly sessions = new Map<string, PresentationSession>();

  constructor(private readonly host: PresentationHost) {}

  open(
    output: OutputLayout,
    screen: ScreenBinding | null = null,
  ): PresentationOpenResult {
    const existing = this.sessions.get(output.id);
    if (existing && !existing.lost) {
      existing.target.focus?.();
      return { ok: true, session: existing };
    }
    const result = openPresentation(this.host, output, screen);
    if (result.ok) {
      this.sessions.set(output.id, result.session);
    }
    return result;
  }

  get(outputId: string): PresentationSession | undefined {
    const session = this.sessions.get(outputId);
    if (session?.lost) {
      this.sessions.delete(outputId);
      return undefined;
    }
    return session;
  }

  /** Removes windows the user closed. Returns the ids that were dropped. */
  reconcile(): readonly string[] {
    const lost: string[] = [];
    for (const [outputId, session] of this.sessions) {
      if (session.lost) {
        lost.push(outputId);
        this.sessions.delete(outputId);
      }
    }
    return lost;
  }

  close(outputId: string): void {
    const session = this.sessions.get(outputId);
    if (session) {
      closePresentation(session);
      this.sessions.delete(outputId);
    }
  }

  closeAll(): void {
    for (const outputId of [...this.sessions.keys()]) {
      this.close(outputId);
    }
  }

  get size(): number {
    return this.sessions.size;
  }
}
