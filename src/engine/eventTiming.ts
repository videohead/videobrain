export interface TriggerEvent { id: string; time: number; sequence: number }
export type EventBatch = readonly TriggerEvent[];
export const MAX_EVENTS_PER_TICK = 64;
export const EMPTY_EVENTS: EventBatch = Object.freeze([]);

export function orderedEvents(events: EventBatch): TriggerEvent[] {
  if (events.length > 4096) throw new Error('Event input exceeds 4096 entries.');
  const seen = new Set<string>();
  return events.filter((event) => {
    if (!event.id || event.id.length > 128 || !Number.isFinite(event.time) || event.time < 0 || !Number.isSafeInteger(event.sequence) || event.sequence < 0) throw new Error('Invalid event identity or timestamp.');
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  }).sort((left, right) => left.time - right.time || left.sequence - right.sequence || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

export function easeProgress(value: number, curve: string): number {
  const progress = Math.max(0, Math.min(1, value));
  if (curve === 'smooth') return progress * progress * (3 - 2 * progress);
  if (curve === 'easeIn') return progress * progress;
  if (curve === 'easeOut') return 1 - (1 - progress) * (1 - progress);
  return progress;
}

export interface TransitionState { value: number; from: number; target: number; elapsed: number; duration: number; active: boolean }
export function transitionState(initial: number): TransitionState { return { value: initial, from: initial, target: initial, elapsed: 0, duration: 0, active: false }; }
export function advanceTransition(state: TransitionState, elapsed: number, curve: string): boolean {
  if (!state.active) return false;
  state.elapsed += Math.max(0, elapsed);
  const progress = state.duration <= 0 ? 1 : Math.min(1, state.elapsed / state.duration);
  state.value = state.from + (state.target - state.from) * easeProgress(progress, curve);
  if (progress < 1) return false;
  state.active = false;
  state.value = state.target;
  return true;
}
export function startTransition(state: TransitionState, target: number, duration: number, retrigger: string): boolean {
  if (state.active && retrigger === 'ignore') return false;
  state.from = state.value;
  state.target = target;
  state.duration = Math.max(0, duration);
  state.elapsed = 0;
  state.active = true;
  return true;
}

export interface ScheduledCue { id: string; at: number; value: number; sequence: number }
export function parseSchedule(text: string): ScheduledCue[] {
  if (text.length > 16384) throw new Error('Schedule exceeds 16 KiB.');
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value) || value.length > 256) throw new Error('Schedule requires at most 256 cues.');
  const ids = new Set<string>();
  return value.map((entry: unknown, sequence): ScheduledCue => {
    if (typeof entry !== 'object' || entry === null) throw new Error('Invalid cue.');
    const cue = entry as Record<string, unknown>;
    if (typeof cue.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(cue.id) || ids.has(cue.id) ||
      typeof cue.at !== 'number' || !Number.isSafeInteger(cue.at) || cue.at < 0 || cue.at > 86400000 ||
      typeof cue.value !== 'number' || !Number.isFinite(cue.value) || Math.abs(cue.value) > 1e6) throw new Error('Cue needs unique id, integer at (0..86400000 ms), and finite value (+/-1e6).');
    ids.add(cue.id);
    return { id: cue.id, at: cue.at / 1000, value: cue.value, sequence };
  }).sort((left, right) => left.at - right.at || left.sequence - right.sequence);
}

export function dueCues(cues: readonly ScheduledCue[], previous: number, time: number) {
  const due = cues.filter((cue) => cue.at > previous && cue.at <= time);
  return { cues: due.slice(-MAX_EVENTS_PER_TICK), dropped: Math.max(0, due.length - MAX_EVENTS_PER_TICK), value: due.at(-1)?.value };
}

export function seededValue(seed: number, step: number): number {
  let bits = (Math.floor(seed) ^ Math.imul(step + 1, 0x9e3779b1)) >>> 0;
  bits = Math.imul(bits ^ bits >>> 16, 0x85ebca6b);
  bits = Math.imul(bits ^ bits >>> 13, 0xc2b2ae35);
  return ((bits ^ bits >>> 16) >>> 0) / 4294967296;
}