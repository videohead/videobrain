import type { CompiledNode } from '../graph';
import { EVENT_DEFINITIONS } from '../graph/eventOperators';
import { advanceTransition, dueCues, EMPTY_EVENTS, MAX_EVENTS_PER_TICK, orderedEvents, parseSchedule, seededValue, startTransition, transitionState, type EventBatch, type TransitionState } from './eventTiming';

export type EventValue = number | boolean | EventBatch;
interface State {
  time: number;
  signature: string;
  value: number;
  previousBool: boolean | null;
  seen: Set<string>;
  serial: number;
  elapsed: number;
  active: boolean;
  duration: number;
  phase: number;
  step: number;
  randomStep: number;
  pulseUntil: number;
  transition: TransitionState;
  stage: 'idle' | 'attack' | 'hold' | 'release';
  holdElapsed: number;
  scheduleText: string;
  schedule: ReturnType<typeof parseSchedule>;
}
const kinds = new Set(EVENT_DEFINITIONS.map(({ kind }) => kind));
export function isEventNode(kind: CompiledNode['node']['kind']) { return kinds.has(kind); }

export class EventEvaluator {
  private states = new Map<string, State>();
  clear() { this.states.clear(); }
  retain(ids: Set<string>) { for (const id of this.states.keys()) if (!ids.has(id)) this.states.delete(id); }
  evaluate(compiled: CompiledNode, input: Record<string, EventValue>, time: number): Record<string, EventValue> {
    const { node, definition } = compiled;
    const number = (id: string) => {
      const parameter = definition.params[id];
      const value = input[id] ?? node.params[id];
      const fallback = parameter?.type === 'number' ? parameter.defaultValue : 0;
      const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
      return parameter?.type === 'number' ? Math.max(parameter.min, Math.min(parameter.max, numeric)) : numeric;
    };
    const bool = (id: string) => typeof input[id] === 'boolean' ? input[id] === true : node.params[id] === true;
    const initial = number('initial');
    const signature = JSON.stringify([node.kind, compiled.inputs, node.params.cues, node.params.seed]);
    let state = this.states.get(node.id);
    const fresh = !state || time < state.time || signature !== state.signature;
    if (fresh) {
      state = { time, signature, value: initial, previousBool: null, seen: new Set(), serial: 0, elapsed: 0, active: false, duration: 0, phase: 0, step: 0, randomStep: 0, pulseUntil: -Infinity, transition: transitionState(initial), stage: 'idle', holdElapsed: 0, scheduleText: '', schedule: [] };
      this.states.set(node.id, state);
    }
    if (!state) throw new Error('Event state unavailable.');
    const current = state;
    const previousTime = current.time;
    const delta = Math.max(0, time - previousTime);
    current.time = time;
    const result: Record<string, EventValue> = {};
    for (const port of definition.outputs) result[port.id] = port.type === 'event.trigger' ? EMPTY_EVENTS : port.type === 'control.bool' ? false : 0;
    const emit = (port: string, at = time) => {
      const events = result[port] as EventBatch;
      if (events.length >= MAX_EVENTS_PER_TICK) { result.dropped = Number(result.dropped ?? 0) + 1; return; }
      const sequence = current.serial++;
      result[port] = [...events, { id: `${node.id}:${sequence}`, time: Math.max(0, at), sequence }];
    };
    const events = (ports: string[]) => {
      const collected: { port: string; event: EventBatch[number]; priority: number }[] = [];
      ports.forEach((port, priority) => {
        const batch = input[port];
        if (!Array.isArray(batch)) return;
        for (const event of orderedEvents(batch)) {
          if (event.time > time) continue;
          const id = `${port}:${event.id}`;
          if (current.seen.has(id)) continue;
          current.seen.add(id);
          collected.push({ port, event, priority });
        }
      });
      while (current.seen.size > 4096) current.seen.delete(current.seen.values().next().value!);
      return collected.sort((left, right) => left.event.time - right.event.time || left.priority - right.priority || left.event.sequence - right.event.sequence || left.event.id.localeCompare(right.event.id)).slice(-MAX_EVENTS_PER_TICK);
    };
    const boundedRange = (value: number) => Math.max(Math.min(number('min'), number('max')), Math.min(Math.max(number('min'), number('max')), value));
    const curve = String(node.params.curve ?? 'linear');
    const paused = bool('paused');

    switch (node.kind) {
      case 'controlToBool': result.value = number('value') >= number('threshold'); break;
      case 'boolToControl': result.value = bool('value') ? number('high') : number('low'); break;
      case 'compare': {
        const first = number('a'); const second = number('b');
        result.value = node.params.operation === 'equal' ? Math.abs(first - second) <= number('tolerance')
          : node.params.operation === 'notEqual' ? Math.abs(first - second) > number('tolerance')
          : node.params.operation === 'less' ? first < second
          : node.params.operation === 'inside' ? first >= Math.min(number('min'), number('max')) && first <= Math.max(number('min'), number('max')) : first > second;
        break;
      }
      case 'logic': result.value = node.params.operation === 'not' ? !bool('a') : node.params.operation === 'or' ? bool('a') || bool('b') : node.params.operation === 'xor' ? bool('a') !== bool('b') : bool('a') && bool('b'); break;
      case 'trigger': {
        const value = bool('value');
        if (current.previousBool !== null && value !== current.previousBool && (node.params.edge === 'both' || node.params.edge === (value ? 'rising' : 'falling'))) emit('event');
        current.previousBool = value;
        break;
      }
      case 'eventToControl':
        if (events(['event']).length) current.pulseUntil = time + number('duration');
        result.value = time < current.pulseUntil ? 1 : 0;
        break;
      case 'gate':
        result.value = bool('open') ? number('value') : number('closed');
        for (const entry of events(['event'])) if (bool('open')) emit('event', entry.event.time);
        break;
      case 'hold':
        if (bool('open')) current.value = number('value');
        if (events(['reset']).length) current.value = initial;
        result.value = current.value;
        break;
      case 'sampleHold':
        for (const entry of events(['sample', 'reset'])) current.value = entry.port === 'reset' ? initial : number('value');
        result.value = current.value;
        break;
      case 'counter': {
        current.value = boundedRange(current.value);
        for (const entry of events(['increment', 'decrement', 'reset'])) {
          if (entry.port === 'reset') current.value = boundedRange(initial);
          else {
            const next = current.value + (entry.port === 'increment' ? 1 : -1) * number('step');
            const min = Math.min(number('min'), number('max')); const max = Math.max(number('min'), number('max'));
            current.value = node.params.boundary === 'wrap' ? next > max ? min : next < min ? max : next : boundedRange(next);
          }
        }
        result.value = current.value; break;
      }
      case 'random':
        for (const entry of events(['next', 'reset'])) current.randomStep = entry.port === 'reset' ? 0 : current.randomStep + 1;
        result.value = number('min') + (number('max') - number('min')) * seededValue(number('seed'), current.randomStep);
        break;
      case 'timer': case 'timedTransition': case 'envelope': {
        const advance = (duration: number, at: number) => {
          if (paused) return;
          if (node.kind === 'timer') {
            if (!current.active) return;
            current.elapsed += duration;
            if (current.duration === 0) { emit('done', at); current.active = false; return; }
            const count = Math.floor((current.elapsed + 1e-10) / current.duration);
            if (!count) return;
            if (bool('repeat')) {
              const emitted = Math.min(count, MAX_EVENTS_PER_TICK);
              result.dropped = Number(result.dropped) + Math.max(0, count - emitted);
              for (let index = count - emitted; index < count; index++) emit('done', at - current.elapsed + (index + 1) * current.duration);
              current.elapsed %= current.duration;
            } else { emit('done', at - Math.max(0, current.elapsed - current.duration)); current.elapsed = current.duration; current.active = false; }
          } else if (node.kind === 'timedTransition') {
            if (advanceTransition(current.transition, duration, curve)) emit('done', at - Math.max(0, current.transition.elapsed - current.transition.duration));
          } else {
            let remaining = duration;
            for (let stageCount = 0; stageCount < 4 && current.stage !== 'idle'; stageCount++) {
              const span = current.stage === 'hold' ? Math.max(0, number('hold') - current.holdElapsed) : Math.max(0, current.transition.duration - current.transition.elapsed);
              const elapsed = Math.min(remaining, span);
              remaining -= elapsed;
              if (current.stage === 'hold') current.holdElapsed += elapsed;
              else advanceTransition(current.transition, elapsed, curve);
              if (elapsed < span) break;
              if (current.stage === 'attack') { current.stage = 'hold'; current.holdElapsed = 0; }
              else if (current.stage === 'hold') { current.stage = 'release'; startTransition(current.transition, initial, number('release'), 'restart'); }
              else { current.stage = 'idle'; emit('done', at - remaining); }
            }
          }
        };
        const incoming = events(node.kind === 'timer' ? ['start', 'cancel'] : node.kind === 'envelope' ? ['start', 'release', 'cancel'] : ['start', 'reverse', 'cancel']);
        let cursor = previousTime;
        for (const entry of incoming) {
          const at = Math.max(previousTime, Math.min(time, entry.event.time));
          advance(at - cursor, at); cursor = at;
          if (node.kind === 'timer') {
            if (entry.port === 'cancel') current.active = false;
            else if (!current.active || node.params.retrigger !== 'ignore') { current.elapsed = 0; current.duration = number('duration'); current.active = true; emit('started', at); }
          } else if (node.kind === 'timedTransition') {
            if (entry.port === 'cancel') current.transition.active = false;
            else {
              const target = entry.port === 'reverse' ? initial : number('target');
              if (startTransition(current.transition, target, number('duration'), entry.port === 'reverse' ? 'restart' : String(node.params.retrigger))) emit('started', at);
            }
          } else {
            if (entry.port === 'cancel') { current.stage = 'idle'; current.transition.active = false; }
            else if (entry.port === 'release') { current.stage = 'release'; startTransition(current.transition, initial, number('release'), 'restart'); }
            else if (current.stage === 'idle' || node.params.retrigger !== 'ignore') { current.stage = 'attack'; startTransition(current.transition, number('peak'), number('attack'), 'restart'); }
          }
          advance(0, at);
        }
        advance(time - cursor, time);
        if (node.kind === 'timer') {
          result.progress = current.duration > 0 ? Math.min(1, current.elapsed / current.duration) : current.active ? 0 : current.serial > 0 ? 1 : 0;
          result.active = current.active;
        } else {
          result.value = current.transition.value;
          result.active = node.kind === 'envelope' ? current.stage !== 'idle' : current.transition.active;
          if (node.kind === 'timedTransition') result.progress = current.transition.duration > 0 ? Math.min(1, current.transition.elapsed / current.transition.duration) : current.transition.value === initial ? 0 : 1;
        }
        break;
      }
      case 'stepSequencer': {
        const reset = fresh || events(['reset']).length > 0;
        const first = Math.min(Math.floor(number('first')), Math.floor(number('last')));
        const last = Math.max(Math.floor(number('first')), Math.floor(number('last')));
        if (reset) { current.phase = 0; current.step = 0; if (bool('running')) emit('step'); }
        else if (bool('running')) {
          const duration = node.params.mode === 'beats' ? number('beats') * 60 / number('bpm') : number('seconds');
          const position = current.phase + delta / duration;
          const count = Math.floor(position + 1e-10);
          current.phase = position - count;
          current.step += count;
          const emitted = Math.min(count, MAX_EVENTS_PER_TICK);
          result.dropped = Math.max(0, count - emitted);
          for (let index = count - emitted; index < count; index++) emit('step', time - (position - index - 1) * duration);
        }
        const index = first + current.step % (last - first + 1);
        result.index = index; result.phase = Math.max(0, current.phase); result.value = number(`step${index + 1}`);
        break;
      }
      case 'cueScheduler': {
        const scheduleText = String(node.params.cues);
        if (current.scheduleText !== scheduleText) { current.schedule = parseSchedule(scheduleText); current.scheduleText = scheduleText; }
        const reset = fresh || events(['reset']).length > 0;
        const before = reset ? -1 : current.elapsed;
        if (reset) { current.elapsed = 0; current.value = initial; }
        else if (bool('running')) current.elapsed += delta;
        if (bool('running')) {
          const due = dueCues(current.schedule, before, current.elapsed);
          if (due.value !== undefined) current.value = due.value;
          result.dropped = due.dropped;
          for (const cue of due.cues) emit('cue', Math.max(0, time - (current.elapsed - cue.at)));
        }
        result.value = bool('overrideEnabled') ? number('override') : current.value;
        break;
      }
    }
    return result;
  }
}