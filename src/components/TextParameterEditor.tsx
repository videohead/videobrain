import { useId, useState } from 'react';
import { Check } from 'lucide-react';
import type { TextParamDefinition } from '../graph/types';

interface TextParameterEditorProps {
  value: string;
  parameter: TextParamDefinition;
  label: string;
  onApply: (value: string) => void;
  onSelect?: () => void;
  code?: boolean;
}

export function TextParameterEditor({ value, parameter, label, onApply, onSelect, code = false }: TextParameterEditorProps) {
  const inputId = useId();
  const [length, setLength] = useState(value.length);
  return (
    <form className="node-parameter node-parameter-text text-parameter-editor nodrag nopan nowheel"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const draft = new FormData(event.currentTarget).get('text');
        if (typeof draft === 'string') onApply(draft.slice(0, parameter.maxLength));
      }}>
      <label className="node-parameter-label" htmlFor={inputId}>{parameter.label}</label>
      {parameter.multiline ? <textarea id={inputId} name="text" aria-label={label} aria-describedby={`${inputId}-count`}
        className={`nodrag nopan nowheel${code ? ' shader-code-editor' : ''}`} defaultValue={value} maxLength={parameter.maxLength}
        spellCheck={code ? false : undefined}
        placeholder={parameter.placeholder} rows={code ? 10 : 4} onFocus={onSelect}
        onInput={(event) => setLength(event.currentTarget.value.length)} /> :
        <input id={inputId} name="text" type="text" aria-label={label} aria-describedby={`${inputId}-count`}
          className="nodrag nopan nowheel" defaultValue={value} maxLength={parameter.maxLength}
          placeholder={parameter.placeholder} onFocus={onSelect}
          onInput={(event) => setLength(event.currentTarget.value.length)} />}
      <div className="text-parameter-actions">
        <output id={`${inputId}-count`}>{length}/{parameter.maxLength}</output>
        <button type="submit" className="text-button" aria-label={`Apply ${label}`}>
          <Check size={13} aria-hidden="true" /> Apply
        </button>
      </div>
    </form>
  );
}