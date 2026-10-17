import { useMemo, useState } from 'react';
import { Crosshair } from 'lucide-react';
import { getOperatorDefinition, type NodeKind } from '../graph';
import { DOMAIN_LABELS, OPERATOR_META } from './operatorMeta';

export interface SearchableGraphNode {
  id: string;
  kind: NodeKind;
}

interface NodeSearchProps {
  nodes: readonly SearchableGraphNode[];
  onSelect: (nodeId: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

function nodeLabel(kind: NodeKind): string {
  const meta = OPERATOR_META[kind];
  const definition = getOperatorDefinition(kind);
  return `${definition.title} ${meta.shortLabel} ${kind}`.toLowerCase();
}

export function NodeSearch({ nodes, onSelect, inputRef }: NodeSearchProps) {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();

  const results = useMemo(() => {
    if (!normalized) {
      return nodes;
    }
    return nodes.filter((node) => nodeLabel(node.kind).includes(normalized));
  }, [nodes, normalized]);

  return (
    <div className="node-search">
      <label className="node-search-field">
        <span className="sr-only">Search nodes in this patch</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search nodes in this patch…"
          autoComplete="off"
          type="search"
        />
      </label>

      <div className="node-search-results" role="listbox" aria-label="Matching nodes">
        {results.length === 0 ? (
          <div className="node-search-empty">
            {normalized
              ? `No nodes match “${query.trim()}”.`
              : 'This patch has no nodes yet.'}
          </div>
        ) : (
          results.map((node) => {
            const meta = OPERATOR_META[node.kind];
            const Icon = meta.icon;
            const definition = getOperatorDefinition(node.kind);
            return (
              <button
                key={node.id}
                type="button"
                className="node-search-item"
                role="option"
                aria-selected="false"
                style={{ '--node-accent': meta.accent } as React.CSSProperties}
                onClick={() => onSelect(node.id)}
              >
                <span className="node-search-icon" aria-hidden="true">
                  <Icon />
                </span>
                <span className="node-search-copy">
                  <span className="node-search-name">{definition.title}</span>
                  <span className="node-search-meta">
                    {DOMAIN_LABELS[definition.domain]} · {definition.summary}
                  </span>
                </span>
                <Crosshair size={13} aria-hidden="true" className="node-search-go" />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}