import type { OperatorDefinition, OperatorParamDefinition, PortType } from './types';

const number = (label: string, defaultValue: number, min: number, max: number, step: number): OperatorParamDefinition => ({ type: 'number', label, defaultValue, min, max, step });
const label: OperatorParamDefinition = { type: 'text', label: 'Label', defaultValue: '', maxLength: 80 };
const flash = number('Flash (ms)', 150, 80, 1000, 10);
const monitor = (kind: OperatorDefinition['kind'], title: string, summary: string, type: PortType, params: Record<string, OperatorParamDefinition>): OperatorDefinition => ({
  kind, title, summary, domain: 'control', category: 'output',
  inputs: [{ id: 'value', label: type === 'event.trigger' ? 'Event' : 'Value', type, optional: true }],
  outputs: [{ id: 'value', label: type === 'event.trigger' ? 'Event' : 'Value', type }],
  params: { label, ...params }, execution: { visualPasses: 0, renderTargets: 0, stateful: true },
});

export const SIGNAL_TEST_DEFINITIONS: readonly OperatorDefinition[] = [
  monitor('signalNumber', 'Signal Number', 'Numeric demand-root monitor with an unscaled readout, configurable-range meter, and unchanged scalar output.', 'control.f32', {
    min: number('Meter minimum', 0, -1e9, 1e9, 0.01), max: number('Meter maximum', 1, -1e9, 1e9, 0.01), decimals: number('Decimals', 3, 0, 8, 1),
  }),
  monitor('signalText', 'Signal Text', 'Text demand-root monitor; preview is limited to 2048 characters, output passes the complete input unchanged.', 'text.utf8', {}),
  monitor('signalEdge', 'Signal Edge', 'Boolean state, leading/rising and falling edge counts; initial state seeds without counting an edge.', 'control.bool', { flash }),
  monitor('signalBang', 'Signal Bang', 'Flash and count incoming events, forward them, or click to fire a manual event. Works without Display.', 'event.trigger', { flash }),
];

const kinds = new Set(SIGNAL_TEST_DEFINITIONS.map(({ kind }) => kind));
export function isSignalTest(kind: OperatorDefinition['kind']) { return kinds.has(kind); }