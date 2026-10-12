import { describe, expect, it, vi } from 'vitest';

import type { OutputLayout } from '../store/contracts';
import {
  PresentationRegistry,
  closePresentation,
  openPresentation,
  presentationFeatures,
  requestScreens,
  supportsScreenPlacement,
  type PresentationHost,
  type PresentationTarget,
} from './presentationWindow';

const output = (overrides: Partial<OutputLayout> = {}): OutputLayout => ({
  id: 'output-1',
  name: 'Stage Left',
  width: 1920,
  height: 1080,
  layoutX: 0,
  layoutY: 0,
  surfaces: [],
  ...overrides,
});

function fakeTarget(): PresentationTarget {
  const target = {
    closed: false,
    close: () => {
      target.closed = true;
    },
    focus: vi.fn(),
    document: { title: '' },
  };
  return target;
}

function fakeHost(
  overrides: Partial<PresentationHost> = {},
): PresentationHost & { opened: { features: string }[] } {
  const opened: { features: string }[] = [];
  return {
    opened,
    open: (_url, _target, features) => {
      opened.push({ features });
      return fakeTarget();
    },
    ...overrides,
  };
}

describe('capability detection', () => {
  it('reports unsupported when the browser lacks the API', () => {
    expect(supportsScreenPlacement(fakeHost())).toBe(false);
  });

  it('reports supported when the API is present', () => {
    expect(
      supportsScreenPlacement(
        fakeHost({ getScreenDetails: () => Promise.resolve({ screens: [] }) }),
      ),
    ).toBe(true);
  });

  it('returns unsupported rather than throwing', async () => {
    expect(await requestScreens(fakeHost())).toEqual({ state: 'unsupported' });
  });

  it('normalizes granted screen details', async () => {
    const access = await requestScreens(
      fakeHost({
        getScreenDetails: () =>
          Promise.resolve({
            screens: [
              {
                label: 'Built-in',
                width: 2560,
                height: 1600,
                left: 0,
                top: 0,
                isPrimary: true,
                isInternal: true,
              },
              { width: 1920, height: 1080, left: 2560, top: 0 },
            ],
          }),
      }),
    );
    expect(access.state).toBe('granted');
    if (access.state !== 'granted') return;
    expect(access.screens[0]).toMatchObject({
      label: 'Built-in',
      isPrimary: true,
      left: 0,
    });
    // An unlabelled screen still gets a stable, human-readable name.
    expect(access.screens[1]?.label).toBe('Screen 2');
    expect(access.screens[1]?.left).toBe(2560);
  });

  it('reports a refused permission as a state, not an error', async () => {
    const access = await requestScreens(
      fakeHost({
        getScreenDetails: () => Promise.reject(new Error('Permission denied')),
      }),
    );
    expect(access).toEqual({ state: 'denied', reason: 'Permission denied' });
  });
});

describe('window features', () => {
  it('requests a chrome-free popup at the output size', () => {
    const features = presentationFeatures(output(), null);
    expect(features).toContain('popup=yes');
    expect(features).toContain('toolbar=no');
    expect(features).toContain('menubar=no');
    expect(features).toContain('width=1920');
    expect(features).toContain('height=1080');
  });

  it('offsets placement by the bound screen origin', () => {
    const features = presentationFeatures(
      output({ layoutX: 40, layoutY: 20 }),
      {
        id: '1:External',
        label: 'External',
        width: 1920,
        height: 1080,
        left: 2560,
        top: 0,
        isPrimary: false,
        isInternal: false,
      },
    );
    expect(features).toContain('left=2600');
    expect(features).toContain('top=20');
  });

  it('clamps an oversized output to the dimension ceiling', () => {
    expect(presentationFeatures(output({ width: 99999 }), null)).toContain(
      'width=7680',
    );
  });
});

describe('openPresentation', () => {
  it('opens a titled window', () => {
    const host = fakeHost();
    const result = openPresentation(host, output());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.target.document?.title).toBe('VideoBrain — Stage Left');
    expect(result.session.lost).toBe(false);
  });

  it('reports a blocked popup instead of throwing', () => {
    const result = openPresentation({ open: () => null }, output());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('blocked');
  });

  it('reports an opener that throws', () => {
    const result = openPresentation(
      {
        open: () => {
          throw new Error('Popup unavailable');
        },
      },
      output(),
    );
    expect(result).toEqual({ ok: false, error: 'Popup unavailable' });
  });

  it('refuses an output with no area', () => {
    const result = openPresentation(fakeHost(), output({ width: 0 }));
    expect(result.ok).toBe(false);
  });

  it('marks a session lost once the user closes the window', () => {
    const result = openPresentation(fakeHost(), output());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    result.session.target.closed = true;
    expect(result.session.lost).toBe(true);
  });

  it('tolerates closing a window that is already gone', () => {
    const result = openPresentation(fakeHost(), output());
    if (!result.ok) return;
    result.session.target.closed = true;
    expect(() => closePresentation(result.session)).not.toThrow();
  });
});

describe('PresentationRegistry', () => {
  it('reuses and focuses an open window for the same output', () => {
    const registry = new PresentationRegistry(fakeHost());
    const first = registry.open(output());
    const second = registry.open(output());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.session).toBe(first.session);
    expect(first.session.target.focus).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(1);
  });

  it('opens a fresh window after the user closed the previous one', () => {
    const registry = new PresentationRegistry(fakeHost());
    const first = registry.open(output());
    if (!first.ok) return;
    first.session.target.closed = true;
    const second = registry.open(output());
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.session).not.toBe(first.session);
  });

  it('drops lost windows on reconcile', () => {
    const registry = new PresentationRegistry(fakeHost());
    const first = registry.open(output());
    registry.open(output({ id: 'output-2', name: 'Stage Right' }));
    if (!first.ok) return;
    first.session.target.closed = true;
    expect(registry.reconcile()).toEqual(['output-1']);
    expect(registry.size).toBe(1);
    expect(registry.get('output-1')).toBeUndefined();
  });

  it('closes one output and then every remaining output', () => {
    const registry = new PresentationRegistry(fakeHost());
    registry.open(output());
    registry.open(output({ id: 'output-2', name: 'Stage Right' }));
    registry.close('output-1');
    expect(registry.size).toBe(1);
    registry.closeAll();
    expect(registry.size).toBe(0);
  });

  it('does not register a window that failed to open', () => {
    const registry = new PresentationRegistry({ open: () => null });
    expect(registry.open(output()).ok).toBe(false);
    expect(registry.size).toBe(0);
  });
});
