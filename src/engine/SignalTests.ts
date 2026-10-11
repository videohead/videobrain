import { MAX_EVENTS_PER_TICK, orderedEvents, type EventBatch } from './eventTiming';

export interface SignalSnapshot {
  connected: boolean;
  value: number;
  text: string;
  high: boolean;
  rising: number;
  falling: number;
  count: number;
  lastTime: number | null;
  flash: boolean;
  dropped: number;
}
interface Entry {
  snapshot: SignalSnapshot;
  previous: boolean | null;
  seen: Set<string>;
  manual: number;
  serial: number;
  time: number;
  binding: string;
  expiry?: ReturnType<typeof setTimeout>;
}
const EMPTY: SignalSnapshot = Object.freeze({ connected: false, value: 0, text: '', high: false, rising: 0, falling: 0, count: 0, lastTime: null, flash: false, dropped: 0 });

export class SignalTests {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private notification?: ReturnType<typeof setTimeout>;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = (id: string): SignalSnapshot => this.entries.get(id)?.snapshot ?? EMPTY;
  private entry(id: string): Entry {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { snapshot: EMPTY, previous: null, seen: new Set(), manual: 0, serial: 0, time: 0, binding: '' };
      this.entries.set(id, entry);
    }
    return entry;
  }
  private publish(entry: Entry, patch: Partial<SignalSnapshot>) {
    const next = { ...entry.snapshot, ...patch };
    if (Object.keys(next).every((key) => Object.is(next[key as keyof SignalSnapshot], entry.snapshot[key as keyof SignalSnapshot]))) return;
    entry.snapshot = next;
    if (this.notification === undefined) this.notification = setTimeout(() => {
      this.notification = undefined;
      this.listeners.forEach((listener) => listener());
    }, 50);
  }
  private pulse(entry: Entry, milliseconds: number) {
    clearTimeout(entry.expiry);
    this.publish(entry, { flash: true });
    entry.expiry = setTimeout(() => this.publish(entry, { flash: false }), Math.max(80, Math.min(1000, milliseconds)));
  }
  prepare(id: string, time: number, binding: string) {
    let entry = this.entry(id);
    if (time < entry.time || binding !== entry.binding) {
      const manual = entry.manual;
      clearTimeout(entry.expiry);
      this.entries.delete(id);
      entry = this.entry(id);
      entry.manual = manual;
      this.publish(entry, { ...EMPTY });
    }
    entry.time = time;
    entry.binding = binding;
  }
  number(id: string, value: number, connected: boolean) { this.publish(this.entry(id), { value, connected }); }
  text(id: string, text: string, connected: boolean) { this.publish(this.entry(id), { text: text.slice(0, 2048), connected }); }
  edge(id: string, high: boolean, connected: boolean, time: number, milliseconds: number) {
    const entry = this.entry(id);
    const changed = connected && entry.previous !== null && high !== entry.previous;
    this.publish(entry, {
      connected, high,
      rising: entry.snapshot.rising + (changed && high ? 1 : 0),
      falling: entry.snapshot.falling + (changed && !high ? 1 : 0),
      lastTime: changed ? time : entry.snapshot.lastTime,
    });
    if (changed && high) this.pulse(entry, milliseconds);
    entry.previous = connected ? high : null;
  }
  bang(id: string, batch: EventBatch, connected: boolean, time: number, milliseconds: number): EventBatch {
    const entry = this.entry(id);
    const accepted = orderedEvents(batch).filter((event) => {
      if (event.time > time || entry.seen.has(event.id)) return false;
      entry.seen.add(event.id);
      return true;
    });
    const total = accepted.length + entry.manual;
    for (let index = 0; index < entry.manual; index++) {
      const sequence = entry.serial++;
      accepted.push({ id: `signal:${id}:${sequence}`, sequence, time });
    }
    entry.manual = 0;
    while (entry.seen.size > 4096) entry.seen.delete(entry.seen.values().next().value!);
    const result = orderedEvents(accepted).slice(-MAX_EVENTS_PER_TICK);
    this.publish(entry, { connected, count: entry.snapshot.count + result.length, dropped: entry.snapshot.dropped + Math.max(0, total - result.length), lastTime: result.at(-1)?.time ?? entry.snapshot.lastTime });
    if (result.length) this.pulse(entry, milliseconds);
    return result;
  }
  fire(id: string) {
    const entry = this.entry(id);
    if (entry.manual < MAX_EVENTS_PER_TICK) entry.manual++;
    else this.publish(entry, { dropped: entry.snapshot.dropped + 1 });
    window.dispatchEvent(new Event('videobrain:signal-test'));
  }
  clearCounts(id: string) {
    const entry = this.entry(id);
    clearTimeout(entry.expiry);
    this.publish(entry, { count: 0, rising: 0, falling: 0, lastTime: null, flash: false, dropped: 0 });
  }
  retain(ids: Set<string>) {
    let changed = false;
    for (const [id, entry] of this.entries) if (!ids.has(id)) {
      clearTimeout(entry.expiry); this.entries.delete(id); changed = true;
    }
    if (changed) this.listeners.forEach((listener) => listener());
  }
  reset() {
    for (const entry of this.entries.values()) clearTimeout(entry.expiry);
    this.entries.clear();
    clearTimeout(this.notification); this.notification = undefined;
    this.listeners.forEach((listener) => listener());
  }
}

export const signalTests = new SignalTests();