import { memo } from 'react';
import {
  Handle,
  Position,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  getOperatorDefinition,
  type GraphParamValue,
  type NodeKind,
} from '../graph';
import { NodeParameterControls } from './NodeParameterControls';
import { NodeMediaControls } from './NodeMediaControls';
import { DOMAIN_LABELS, OPERATOR_META } from './operatorMeta';
import { useContext } from 'react';
import { OperatorInputRuntimeContext } from './operatorInputRuntime';
import { useFileInput } from '../hooks/useFileInput';

export interface OperatorNodeData extends Record<string, unknown> {
  kind: NodeKind;
  params: Record<string, GraphParamValue>;
  reachable: boolean;
  onParamChange: (
    nodeId: string,
    paramId: string,
    value: GraphParamValue,
  ) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
  onSelect: () => void;
}

export type OperatorFlowNode = Node<OperatorNodeData, 'operator'>;

function summarizeParams(params: Record<string, GraphParamValue>): string {
  const entry = Object.entries(params)[0];
  if (!entry) {
    return 'ready';
  }
  const [key, value] = entry;
  const shown = typeof value === 'number' ? value.toFixed(2) : String(value);
  return `${key} ${shown}`;
}

function OperatorNodeView({ id, data, selected, isConnectable }: NodeProps<OperatorFlowNode>) {
  const runtime = useContext(OperatorInputRuntimeContext);
  const fileRuntime = useFileInput(
    data.kind === 'file' ? id : `__inactive_${id}`,
    runtime?.mixerConfig ?? null,
  );
  const definition = getOperatorDefinition(data.kind);
  const meta = OPERATOR_META[data.kind];
  const Icon = meta.icon;
  const className = [
    'operator-node',
    selected ? 'selected' : '',
    data.reachable ? '' : 'unreachable',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article
      className={className}
      style={{ '--node-accent': meta.accent } as React.CSSProperties}
      aria-label={`${definition.title} node`}
    >
      <header className="operator-node-header">
        <span className="node-kind-icon" aria-hidden="true">
          <Icon />
        </span>
        <span>
          <span className="node-title">{definition.title}</span>
          <span className="node-family">{DOMAIN_LABELS[definition.domain]}</span>
        </span>
        <span className="node-status" aria-label={data.reachable ? 'Active' : 'Idle'} />
      </header>

      <div className="node-ports">
        <div className="port-column inputs">
          {definition.inputs.map((input) => (
            <div className="port-row" key={input.id}>
              <Handle
                id={input.id}
                type="target"
                position={Position.Left}
                isConnectable={isConnectable}
                className={`vb-handle ${input.type.replace('.', '-')}`}
                aria-label={`${input.label} input, ${input.type}`}
              />
              {input.label}
            </div>
          ))}
        </div>
        <div className="port-column outputs">
          {definition.outputs.map((output) => (
            <div className="port-row" key={output.id}>
              {output.label}
              <Handle
                id={output.id}
                type="source"
                position={Position.Right}
                isConnectable={isConnectable}
                className={`vb-handle ${output.type.replace('.', '-')}`}
                aria-label={`${output.label} output, ${output.type}`}
              />
            </div>
          ))}
        </div>
      </div>

      <NodeMediaControls
        nodeId={id}
        kind={data.kind}
        params={data.params}
        runtime={runtime ? (data.kind === 'file' ? { ...runtime, file: fileRuntime } : runtime) : undefined}
        onSelect={data.onSelect}
      />
      {data.kind === 'file' ? (
        <input
          ref={fileRuntime.inputRef}
          type="file"
          accept="image/*,video/*,audio/*"
          className="sr-only"
          onChange={(event) => {
            fileRuntime.handleChange?.(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      ) : null}

      <NodeParameterControls
        nodeId={id}
        definition={definition}
        params={data.params}
        onParamChange={data.onParamChange}
        onGestureStart={data.onGestureStart}
        onGestureEnd={data.onGestureEnd}
        onSelect={data.onSelect}
      />

      {Object.keys(definition.params).length === 0 ? (
        <footer className="node-param-summary">
          <span>{definition.kind}</span>
          <strong>{summarizeParams(data.params)}</strong>
        </footer>
      ) : null}
    </article>
  );
}

export const OperatorNode = memo(OperatorNodeView);
