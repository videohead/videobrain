import { useSyncExternalStore } from 'react';
import { Download, Play, Send, Square, Trash2, Upload } from 'lucide-react';
import { dataSessions } from '../engine/DataSessions';
import type { NodeKind } from '../graph';

export function DataNodeControls({ nodeId, kind }: { nodeId: string; kind: NodeKind }) {
  const snapshot = useSyncExternalStore(dataSessions.subscribe, () => dataSessions.snapshot(nodeId));
  const network = ['httpFetch', 'dataSocket', 'serverEvents'].includes(kind);
  const storage = kind === 'dataStorage';
  return <div className="data-node-controls nodrag nowheel" onPointerDown={(event) => event.stopPropagation()}>
    {network ? <div className="data-node-actions">
      <button type="button" className="icon-button" title={kind === 'httpFetch' ? 'Fetch data' : 'Connect data'} aria-label={kind === 'httpFetch' ? 'Fetch data' : 'Connect data'} disabled={snapshot.active} onClick={() => { void dataSessions.action(nodeId, 'start'); }}><Play size={14} /></button>
      <button type="button" className="icon-button" title="Stop data connection" aria-label="Stop data connection" disabled={!snapshot.active} onClick={() => dataSessions.stop(nodeId)}><Square size={14} /></button>
      {kind === 'dataSocket' ? <button type="button" className="icon-button" title="Send text" aria-label="Send text" disabled={!snapshot.active || snapshot.status !== 1} onClick={() => { void dataSessions.action(nodeId, 'send'); }}><Send size={14} /></button> : null}
      <output>{snapshot.active ? snapshot.status ? 'Connected' : 'Connecting' : 'Stopped'}</output>
    </div> : null}
    {storage ? <div className="data-node-actions">
      <button type="button" className="icon-button" title="Read stored text" aria-label="Read stored text" onClick={() => { void dataSessions.action(nodeId, 'read'); }}><Download size={14} /></button>
      <button type="button" className="icon-button" title="Write stored text" aria-label="Write stored text" onClick={() => { void dataSessions.action(nodeId, 'write'); }}><Upload size={14} /></button>
      <button type="button" className="icon-button" title="Delete stored text" aria-label="Delete stored text" onClick={() => { void dataSessions.action(nodeId, 'delete'); }}><Trash2 size={14} /></button>
    </div> : null}
    {snapshot.error ? <output className="data-node-error" role="status">{snapshot.error}</output> : null}
    {kind === 'dataInspect' ? <pre aria-label="Data inspection">{snapshot.preview || 'No data'}</pre> : null}
  </div>;
}