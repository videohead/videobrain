import type { NodeKind, OperatorDefinition, OperatorParamDefinition, PortDefinition, PortType } from './types';

const number = (label: string, defaultValue: number, min = -1e6, max = 1e6, step = 0.01): OperatorParamDefinition => ({ type: 'number', label, defaultValue, min, max, step });
const boolean = (label: string, defaultValue = false): OperatorParamDefinition => ({ type: 'boolean', label, defaultValue });
const select = (label: string, defaultValue: string, options: string[]): OperatorParamDefinition => ({ type: 'select', label, defaultValue, options: options.map((value) => ({ value, label: value })) });
const text = (label: string, defaultValue: string): OperatorParamDefinition => ({ type: 'text', label, defaultValue, maxLength: 16384, multiline: true });
const port = (id: string, type: PortType): PortDefinition => ({ id, type, label: id, optional: true });
const scalar = (id: string) => port(id, 'control.f32');
const bool = (id: string) => port(id, 'control.bool');
const event = (id: string) => port(id, 'event.trigger');
const node = (kind: NodeKind, title: string, summary: string, inputs: PortDefinition[], outputs: PortDefinition[], params: Record<string, OperatorParamDefinition>, stateful = false, timing = false): OperatorDefinition => ({
  kind, title, summary, domain: 'control', category: timing ? 'timing' : 'control', inputs, outputs, params,
  execution: { stateful, visualPasses: 0, renderTargets: 0 },
});
const curve = select('Curve', 'smooth', ['linear', 'smooth', 'easeIn', 'easeOut']);
const retrigger = select('Retrigger', 'restart', ['restart', 'ignore']);

export const EVENT_DEFINITIONS: readonly OperatorDefinition[] = [
  node('controlToBool', 'Control to Bool', 'Explicit threshold conversion from a scalar to sustained boolean state.', [scalar('value')], [bool('value')], { value: number('Value', 0), threshold: number('Threshold', 0.5) }),
  node('boolToControl', 'Bool to Control', 'Explicit boolean conversion to saved low/high scalar values.', [bool('value')], [scalar('value')], { value: boolean('Value'), low: number('Low', 0), high: number('High', 1) }),
  node('compare', 'Compare', 'Numeric equality, inequality, or inclusive range test; returns a boolean.', [scalar('a'), scalar('b')], [bool('value')], { a: number('A', 0), b: number('B', 0.5), operation: select('Operation', 'greater', ['equal', 'notEqual', 'greater', 'less', 'inside']), tolerance: number('Tolerance', 0.001, 0, 1), min: number('Range min', 0), max: number('Range max', 1) }),
  node('logic', 'Logic', 'AND, OR, XOR, or NOT on explicit boolean inputs.', [bool('a'), bool('b')], [bool('value')], { a: boolean('A'), b: boolean('B'), operation: select('Operation', 'and', ['and', 'or', 'xor', 'not']) }),
  node('trigger', 'Trigger', 'Converts boolean changes to ordered events. Initial state seeds without firing.', [bool('value')], [event('event')], { value: boolean('Value'), edge: select('Edge', 'rising', ['rising', 'falling', 'both']) }, true),
  node('eventToControl', 'Event to Control', 'Turns a nonempty event batch into a scalar pulse stretched by the saved duration.', [event('event')], [scalar('value')], { duration: number('Pulse seconds', 0.1, 0.01, 10) }, true),
  node('gate', 'Gate', 'Choose between two scalar inputs using a boolean; route events only while open.', [bool('open'), scalar('value'), scalar('closed'), event('event')], [scalar('value'), event('event')], { open: boolean('Open', true), value: number('Open value', 1), closed: number('Closed value', 0) }),
  node('hold', 'Hold / Latch', 'Track a value while open; closing retains the last value. Reset uses Initial.', [scalar('value'), bool('open'), event('reset')], [scalar('value')], { value: number('Value', 0), open: boolean('Open', true), initial: number('Initial', 0) }, true),
  node('sampleHold', 'Sample & Hold', 'Capture the current scalar on each event; Reset wins at equal timestamps.', [scalar('value'), event('sample'), event('reset')], [scalar('value')], { value: number('Value', 0), initial: number('Initial', 0) }, true),
  node('counter', 'Counter', 'Count ordered increment/decrement events with wrap or clamp; Reset wins ties.', [event('increment'), event('decrement'), event('reset')], [scalar('value')], { initial: number('Initial', 0), min: number('Minimum', 0), max: number('Maximum', 3), step: number('Step', 1, 0.01, 1e6), boundary: select('Boundary', 'wrap', ['wrap', 'clamp']) }, true),
  node('random', 'Random', 'Seeded event-sampled random scalar; reset restarts the same sequence.', [event('next'), event('reset')], [scalar('value')], { seed: number('Seed', 42, 0, 65535, 1), min: number('Minimum', 0), max: number('Maximum', 1) }, true),
  node('timer', 'Timer', 'Event-started timer with progress, repeat, pause, cancellation, and bounded completion events.', [event('start'), event('cancel'), bool('paused')], [scalar('progress'), bool('active'), event('started'), event('done'), scalar('dropped')], { duration: number('Duration (s)', 1, 0, 3600), repeat: boolean('Repeat'), paused: boolean('Paused'), retrigger }, true, true),
  node('envelope', 'Envelope', 'Event-driven attack/hold/release envelope with cancel, pause, and repeatable reset.', [event('start'), event('release'), event('cancel'), bool('paused')], [scalar('value'), bool('active'), event('done')], { attack: number('Attack (s)', 0.2, 0, 60), hold: number('Hold (s)', 0.5, 0, 60), release: number('Release (s)', 0.5, 0, 60), peak: number('Peak', 1), initial: number('Initial', 0), paused: boolean('Paused'), retrigger, curve }, true, true),
  node('timedTransition', 'Timed Transition', 'Start or reverse an eased scalar transition from its current value. Cancel holds the current value.', [event('start'), event('reverse'), event('cancel'), bool('paused'), scalar('target')], [scalar('value'), scalar('progress'), bool('active'), event('started'), event('done')], { initial: number('Initial', 0), target: number('Target', 1), duration: number('Duration (s)', 1, 0, 3600), paused: boolean('Paused'), retrigger, curve }, true, true),
  node('stepSequencer', 'Step Sequencer', 'Eight saved steps on the visual transport clock; tempo changes preserve phase, late ticks retain newest events.', [event('reset'), bool('running')], [scalar('value'), scalar('index'), scalar('phase'), event('step'), scalar('dropped')], {
    mode: select('Clock', 'seconds', ['seconds', 'beats']), seconds: number('Step seconds', 1, 0.01, 60), bpm: number('BPM', 120, 20, 300, 1), beats: number('Beats per step', 1, 0.0625, 16, 0.0625),
    first: number('First step', 0, 0, 7, 1), last: number('Last step', 7, 0, 7, 1), running: boolean('Running', true),
    ...Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`step${index + 1}`, number(`Step ${index + 1}`, index % 2)])),
  }, true, true),
  node('cueScheduler', 'Cue Scheduler', 'Ordered timestamped value cues on the visual transport. Same-time array order wins; no project mutation or device I/O.', [event('reset'), bool('running'), scalar('override'), bool('overrideEnabled')], [scalar('value'), event('cue'), scalar('dropped')], {
    cues: text('Cues JSON', '[{"id":"open","at":0,"value":0},{"id":"rise","at":1000,"value":1},{"id":"close","at":3000,"value":0}]'),
    initial: number('Initial', 0), running: boolean('Running', true), override: number('Override', 0), overrideEnabled: boolean('Override enabled'),
  }, true, true),
];