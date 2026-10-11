import { Minus, Plus } from 'lucide-react';
import { useRef } from 'react';
import type { GraphParams, OperatorDefinition } from '../graph/types';
import { getGradientStops, GRADIENT_STOP_IDS } from '../graph/gradient';

interface GradientStopControlsProps {
  definition: OperatorDefinition;
  params: GraphParams;
  onChange: (paramId: string, value: number) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
  onSelect?: () => void;
}

export function GradientStopControls({ definition, params, onChange, onGestureStart, onGestureEnd, onSelect }: GradientStopControlsProps) {
  const active = useRef(false);
  const values = Object.fromEntries(Object.entries(definition.params).map(([id, parameter]) => [id, params[id] ?? parameter.defaultValue]));
  const stops = getGradientStops(values);
  const start = () => {
    onSelect?.();
    if (!active.current) {
      active.current = true;
      onGestureStart();
    }
  };
  const end = () => {
    if (active.current) {
      active.current = false;
      onGestureEnd();
    }
  };
  const changeCount = (delta: number) => {
    start();
    if (delta > 0) {
      const id = GRADIENT_STOP_IDS[stops.length];
      let position = 0.5;
      let widest = 0;
      for (let index = 1; index < stops.length; index++) {
        const previous = stops[index - 1];
        const current = stops[index];
        if (previous && current && current.position - previous.position > widest) {
          widest = current.position - previous.position;
          position = (previous.position + current.position) / 2;
        }
      }
      if (id) onChange(`${id}Position`, Number(position.toFixed(2)));
    }
    onChange('stopCount', Math.max(2, Math.min(8, stops.length + delta)));
    end();
  };
  const preview = stops.map((stop) => `rgba(${stop.red * 255}, ${stop.green * 255}, ${stop.blue * 255}, ${stop.alpha}) ${stop.position * 100}%`).join(', ');

  return (
    <div className="gradient-stops nodrag nopan nowheel" role="group" aria-label="Gradient color stops"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}>
      <div className="gradient-stops-heading">
        <span>Color stops <output>{stops.length}/8</output></span>
        <button type="button" className="icon-button" aria-label="Remove last color stop" title="Remove last color stop" disabled={stops.length <= 2} onClick={() => changeCount(-1)}><Minus size={14} /></button>
        <button type="button" className="icon-button" aria-label="Add color stop" title="Add color stop" disabled={stops.length >= 8} onClick={() => changeCount(1)}><Plus size={14} /></button>
      </div>
      <div className="gradient-stop-preview" aria-hidden="true"><div style={{ background: `linear-gradient(to right, ${preview})` }} /></div>
      {GRADIENT_STOP_IDS.slice(0, stops.length).map((id, index) => {
        const stop = stops.find((entry) => entry.id === id);
        if (!stop) return null;
        const hex = `#${[stop.red, stop.green, stop.blue].map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}`;
        return (
          <div className="gradient-stop-row" key={id}>
            <label className="gradient-stop-color">
              <span>{index + 1}</span>
              <input type="color" value={hex} aria-label={`Gradient Stop ${index + 1} Color`} onFocus={start} onBlur={end}
                onChange={(event) => {
                  start();
                  ['Red', 'Green', 'Blue'].forEach((channel, channelIndex) => {
                    onChange(`${id}${channel}`, Number.parseInt(event.target.value.slice(1 + channelIndex * 2, 3 + channelIndex * 2), 16) / 255);
                  });
                }} />
            </label>
            <div className="gradient-stop-values">
              {(['Position', 'Alpha'] as const).map((field) => {
                const parameter = definition.params[`${id}${field}`];
                if (parameter?.type !== 'number') return null;
                const value = field === 'Position' ? stop.position : stop.alpha;
                return (
                  <label className="gradient-stop-value" key={field}>
                    <span>{field}</span>
                    <input className="nodrag nopan nowheel" type="range" min={parameter.min} max={parameter.max} step={parameter.step} value={value}
                      aria-label={`Gradient Stop ${index + 1} ${field}`} onFocus={start} onBlur={end}
                      onPointerDown={start} onPointerUp={end} onPointerCancel={end}
                      onKeyDown={start} onKeyUp={end}
                      onChange={(event) => onChange(`${id}${field}`, Number(event.target.value))} />
                    <output>{Math.round(value * 100)}%</output>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}