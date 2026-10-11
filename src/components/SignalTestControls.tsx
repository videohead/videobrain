import { useSyncExternalStore } from 'react';
import { Circle, RotateCcw } from 'lucide-react';
import type { GraphParams, NodeKind } from '../graph';
import { signalTests } from '../engine/SignalTests';

export function SignalTestControls({ nodeId, kind, params }: { nodeId: string; kind: NodeKind; params: GraphParams }) {
  const value = useSyncExternalStore(signalTests.subscribe, () => signalTests.snapshot(nodeId));
  const minimum = Math.min(Number(params.min ?? 0), Number(params.max ?? 1));
  const maximum = Math.max(Number(params.min ?? 0), Number(params.max ?? 1));
  const fraction = maximum > minimum ? Math.max(0, Math.min(1, (value.value - minimum) / (maximum - minimum))) : 0;
  return <section className="signal-test-controls nodrag nowheel" aria-label="Signal readout" onPointerDown={(event) => event.stopPropagation()}>
    <div className="signal-test-heading"><strong>{String(params.label || 'Signal')}</strong><span>{value.connected ? 'Connected' : 'Unconnected'}</span></div>
    {kind === 'signalNumber' ? <>
      <output aria-label="Numeric signal" className="signal-number">{value.connected ? value.value.toFixed(Number(params.decimals ?? 3)) : '--'}</output>
      <meter aria-label="Signal range" min={0} max={1} value={fraction} />
      <div className="signal-test-range"><span>{minimum}</span><span>{maximum}</span></div>
      {value.connected && (value.value < minimum || value.value > maximum) ? <span>Outside meter range</span> : null}
    </> : null}
    {kind === 'signalText' ? <pre aria-label="Text signal">{value.connected ? value.text : 'No input'}</pre> : null}
    {kind === 'signalBang' ? <>
      <button type="button" className={`signal-bang${value.flash ? ' is-lit' : ''}`} aria-label="Fire bang" title="Fire one event" onClick={() => signalTests.fire(nodeId)}><Circle size={28} aria-hidden="true" /></button>
      <output aria-label="Bang count">{value.count}</output>
      {value.dropped > 0 ? <span>Dropped: {value.dropped}</span> : null}
    </> : null}
    {kind === 'signalEdge' ? <>
      <output aria-label="Boolean signal">{value.connected ? value.high ? 'HIGH' : 'LOW' : '--'}</output>
      <span className={`signal-edge-lamp${value.flash ? ' is-lit' : ''}`} aria-label="Leading edge indicator" />
      <div className="signal-test-range"><span>Rising <output aria-label="Rising count">{value.rising}</output></span><span>Falling <output aria-label="Falling count">{value.falling}</output></span></div>
    </> : null}
    {kind === 'signalBang' || kind === 'signalEdge' ? <div className="signal-test-range"><span>Last: {value.lastTime === null ? '--' : `${value.lastTime.toFixed(3)} s`}</span><button type="button" className="icon-button" title="Clear signal counts" aria-label="Clear signal counts" onClick={() => signalTests.clearCounts(nodeId)}><RotateCcw size={12} /></button></div> : null}
  </section>;
}