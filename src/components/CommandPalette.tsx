import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { OPERATOR_DEFINITIONS, type NodeKind } from '../graph';
import { DOMAIN_LABELS, OPERATOR_META } from './operatorMeta';

interface CommandPaletteProps {
  onAdd: (kind: NodeKind) => void;
  onClose: () => void;
}

export function CommandPalette({ onAdd, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return OPERATOR_DEFINITIONS;
    }
    return OPERATOR_DEFINITIONS.filter((definition) =>
      `${definition.title} ${definition.summary} ${definition.kind}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [query]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const safeActiveIndex = Math.min(activeIndex, Math.max(0, results.length - 1));

  const choose = (kind: NodeKind) => {
    onAdd(kind);
    onClose();
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="command-dialog" role="dialog" aria-modal="true" aria-label="Add a node">
        <label className="command-input">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Search nodes</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                onClose();
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) => Math.min(results.length - 1, index + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) => Math.max(0, index - 1));
              } else if (event.key === 'Enter') {
                const result = results[safeActiveIndex];
                if (result) {
                  choose(result.kind);
                }
              }
            }}
            placeholder="Find a signal, visual, or output…"
            autoComplete="off"
          />
          <kbd>esc</kbd>
        </label>
        <div className="command-results">
          {results.map((definition, index) => {
            const meta = OPERATOR_META[definition.kind];
            const Icon = meta.icon;
            return (
              <button
                type="button"
                className={`command-result ${index === safeActiveIndex ? 'active' : ''}`}
                style={{ '--node-accent': meta.accent } as React.CSSProperties}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(definition.kind)}
                key={definition.kind}
              >
                <span className="operator-icon" aria-hidden="true"><Icon /></span>
                <span>
                  {definition.title}
                  <small>{DOMAIN_LABELS[definition.domain]} · {definition.summary}</small>
                </span>
                <CornerDownLeft size={13} aria-hidden="true" />
              </button>
            );
          })}
          {results.length === 0 ? (
            <div className="command-empty">No nodes match “{query}”.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
