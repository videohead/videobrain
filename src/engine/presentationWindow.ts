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
  document?: {
    title?: string;
    body?: { innerHTML?: string } | null;
    write?: (markup: string) => void;
    close?: () => void;
  };
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
