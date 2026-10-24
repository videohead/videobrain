import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Plus, Radio, Trash2, X } from 'lucide-react';
import { OPERATOR_REGISTRY, type GraphParamValue, type OperatorParamDefinition } from '../graph';
import { useGraphDocument } from '../store';
import { controller, type ControlMapping } from '../control/controller';
import type { ControlAction } from '../control/actions';

function ValueInput({ label, parameter, value, onChange }: {
  label: string; parameter: OperatorParamDefinition; value: GraphParamValue; onChange: (value: GraphParamValue) => void;
}) {
  if (parameter.type === 'boolean') return <label><input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
  if (parameter.type === 'select') return <label>{label}<select value={String(value)} onChange={(event) => onChange(event.target.value)}>{parameter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
  if (parameter.type !== 'number') return null;
  return <label>{label}<input type="number" min={parameter.min} max={parameter.max} step={parameter.step} value={Number(value)} onChange={(event) => onChange(event.target.valueAsNumber)} required /></label>;
}

export function ControllerDialog({ onClose }: { onClose: () => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const graph = useGraphDocument();
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [type, setType] = useState<'parameter' | 'source' | 'transport'>('parameter');
  const [nodeId, setNodeId] = useState('');
  const [paramId, setParamId] = useState('');
  const [mode, setMode] = useState<'absolute' | 'set' | 'toggle' | 'momentary'>('absolute');
  const [low, setLow] = useState<GraphParamValue>(0);
  const [high, setHigh] = useState<GraphParamValue>(1);
  const [sourceMode, setSourceMode] = useState<'select' | 'advance'>('select');
  const [sourceIndex, setSourceIndex] = useState(0);
  const [command, setCommand] = useState<'play' | 'pause' | 'toggle' | 'reset'>('toggle');
  const [address, setAddress] = useState('ws://127.0.0.1:8933/control-ws');
  const [token, setToken] = useState('');
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  const definition = node ? OPERATOR_REGISTRY[node.kind] : null;
  const parameter = definition?.params[paramId];
  const eligible = graph.nodes.filter((node) => type !== 'source' || node.kind === 'frameSwitch' || node.kind === 'sourceSelector');

  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => { controller.learn(null); if (previous instanceof HTMLElement) previous.focus(); };
  }, []);

  const selectParameter = (paramId: string) => {
    setParamId(paramId);
    const selected = definition?.params[paramId];
    if (!selected) return;
    setLow(selected.type === 'number' ? selected.min : selected.type === 'boolean' ? false : selected.type === 'select' ? selected.options[0]?.value ?? '' : '');
    setHigh(selected.type === 'number' ? selected.max : selected.type === 'boolean' ? true : selected.type === 'select' ? selected.options.at(-1)?.value ?? '' : '');
    setMode(selected.type === 'number' ? 'absolute' : 'toggle');
  };

  const save = () => {
    const action: ControlAction = type === 'transport' ? { type, command }
      : type === 'source' ? { type, nodeId, mode: sourceMode, index: sourceIndex }
      : { type, nodeId, paramId, mode, low, high };
    controller.save({ id, name, action });
  };

  return <dialog ref={dialog} className="controller-dialog" aria-labelledby="controllers-title" onCancel={onClose}>
    <header className="controller-header"><h2 id="controllers-title">Controllers</h2><button type="button" className="icon-button" title="Close controllers" aria-label="Close controllers" onClick={onClose}><X size={16} /></button></header>
    <div className="controller-content">
      <div className="controller-status"><label><input type="checkbox" checked={state.armed} onChange={(event) => controller.arm(event.target.checked)} /> Armed</label><span role="status">MIDI: {state.midiState} · Companion: {state.bridgeState}</span></div>
      {state.error ? <p className="controller-error" role="alert">{state.error}</p> : null}
      <section aria-labelledby="midi-title"><h3 id="midi-title">MIDI</h3>
        <button className="secondary-button" onClick={() => { if (state.midiState === 'Enabled' || state.midiState === 'Requesting') controller.disableMidi(); else void controller.enableMidi(); }}><Radio size={14} />{state.midiState === 'Enabled' || state.midiState === 'Requesting' ? 'Disable MIDI' : 'Enable MIDI'}</button>
        <ul>{state.devices.map((device) => <li key={device.id}>{device.name}</li>)}</ul>
        {state.learning ? <p role="status">Learning: {state.learning} <button onClick={() => controller.learn(null)}>Cancel</button></p> : null}
      </section>
      <section aria-labelledby="companion-title"><h3 id="companion-title">Bitfocus Companion</h3>
        <form className="controller-form" onSubmit={(event) => { event.preventDefault(); controller.connect(address, token); setToken(''); }}>
          <label>Bridge URL<input type="url" value={address} onChange={(event) => setAddress(event.target.value)} required /></label>
          <label>Bridge key<input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} required /></label>
          <button type="submit" className="secondary-button" disabled={state.bridgeState !== 'Disconnected'}>Connect</button>
          <button type="button" className="secondary-button" onClick={controller.disconnect} disabled={state.bridgeState === 'Disconnected'}>Disconnect</button>
        </form>
      </section>
      <section aria-labelledby="mappings-title"><h3 id="mappings-title">Mappings</h3>
        <div className="controller-mappings">{state.mappings.map((mapping) => <MappingRow key={mapping.id} mapping={mapping} midiEnabled={state.midiState === 'Enabled'} />)}</div>
      </section>
      <section aria-labelledby="mapping-editor-title"><h3 id="mapping-editor-title">Add / replace mapping</h3>
        <form className="controller-form" onSubmit={(event) => { event.preventDefault(); save(); }}>
          <label>Mapping ID<input value={id} pattern="[a-zA-Z0-9_-]{1,64}" maxLength={64} onChange={(event) => setId(event.target.value)} required /></label>
          <label>Name<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} required /></label>
          <label>Action<select value={type} onChange={(event) => { setType(event.target.value as typeof type); setNodeId(''); setParamId(''); }}><option value="parameter">Parameter</option><option value="source">Frame source</option><option value="transport">Transport</option></select></label>
          {type === 'transport' ? <label>Transport command<select value={command} onChange={(event) => setCommand(event.target.value as typeof command)}><option value="play">Play</option><option value="pause">Pause</option><option value="toggle">Play / pause</option><option value="reset">Return to frame zero</option></select></label> : <label>Target node<select value={nodeId} onChange={(event) => { setNodeId(event.target.value); setParamId(''); }} required><option value="">Select node</option>{eligible.map((node) => <option value={node.id} key={node.id}>{OPERATOR_REGISTRY[node.kind].title} · {node.id}</option>)}</select></label>}
          {type === 'source' ? <><label>Source action<select value={sourceMode} onChange={(event) => setSourceMode(event.target.value as typeof sourceMode)}><option value="select">Select</option><option value="advance">Advance</option></select></label><label>Source<select value={sourceIndex} disabled={sourceMode === 'advance'} onChange={(event) => setSourceIndex(Number(event.target.value))}>{['A', 'B', 'C', 'D'].map((label, index) => <option key={label} value={index}>{label}</option>)}</select></label></> : null}
          {type === 'parameter' ? <>
            <label>Parameter<select value={paramId} onChange={(event) => selectParameter(event.target.value)} required><option value="">Select parameter</option>{Object.entries(definition?.params ?? {}).filter(([, parameter]) => parameter.type !== 'text').map(([id, parameter]) => <option key={id} value={id}>{parameter.label}</option>)}</select></label>
            <label>Behavior<select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>{parameter?.type === 'number' ? <option value="absolute">Absolute value</option> : null}<option value="set">Set on press</option><option value="toggle">Toggle</option><option value="momentary">Momentary</option></select></label>
            {parameter ? <><ValueInput label="Low / off" parameter={parameter} value={low} onChange={setLow} /><ValueInput label="High / on" parameter={parameter} value={high} onChange={setHigh} /></> : null}
          </> : null}
          <button type="submit" className="secondary-button"><Plus size={14} />Save mapping</button>
        </form>
      </section>
    </div>
  </dialog>;
}

function MappingRow({ mapping, midiEnabled }: { mapping: ControlMapping; midiEnabled: boolean }) {
  return <div className="controller-mapping"><div><strong>{mapping.name}</strong><code>{mapping.id}</code><span>{mapping.action.type === 'transport' ? mapping.action.command : `${mapping.action.nodeId} · ${mapping.action.type === 'parameter' ? `${mapping.action.paramId} · ${mapping.action.mode}` : mapping.action.mode}`}</span><span>{mapping.midi ? `${mapping.midi.deviceId} · Ch ${mapping.midi.channel} · ${mapping.midi.type.toUpperCase()} ${mapping.midi.number}` : 'No MIDI binding'}</span></div><button className="secondary-button" disabled={!midiEnabled} onClick={() => controller.learn(mapping.id)}>Learn</button><button className="icon-button" title={`Delete ${mapping.name}`} aria-label={`Delete ${mapping.name}`} onClick={() => controller.remove(mapping.id)}><Trash2 size={14} /></button></div>;
}