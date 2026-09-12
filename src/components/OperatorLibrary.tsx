import { useMemo, useState } from 'react';
import { Blocks, ChevronDown, Search } from 'lucide-react';
import {
  OPERATOR_DEFINITIONS,
  type NodeKind,
  type OperatorCategoryId,
  type OperatorDefinition,
} from '../graph';
import { OPERATOR_CATEGORIES } from './operatorCategories';
import { OPERATOR_META } from './operatorMeta';

interface OperatorLibraryProps {
  onAdd: (kind: NodeKind) => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
}

const DEFAULT_EXPANDED_CATEGORIES: readonly OperatorCategoryId[] = [
  'inputs',
  'generators',
];

export function OperatorLibrary({ onAdd, searchInputRef }: OperatorLibraryProps) {
  const [query, setQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<
    ReadonlySet<OperatorCategoryId>
  >(() => new Set(DEFAULT_EXPANDED_CATEGORIES));
  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;
  const groups = useMemo(() => {
    const visible = normalizedQuery
      ? OPERATOR_DEFINITIONS.filter((definition) =>
          `${definition.title} ${definition.summary} ${definition.kind} ${definition.category} ${
            OPERATOR_CATEGORIES.find(
              (category) => category.id === definition.category,
            )?.label ?? ''
          }`
            .toLowerCase()
            .includes(normalizedQuery),
        )
      : OPERATOR_DEFINITIONS;

    return OPERATOR_CATEGORIES.map((category) => ({
      category,
      definitions: visible.filter(
        (definition) => definition.category === category.id,
      ),
    })).filter((group) => group.definitions.length > 0);
  }, [normalizedQuery]);

  const toggleCategory = (categoryId: OperatorCategoryId) => {
    setExpandedCategories((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  return (
    <aside className="operator-library" aria-label="Node library">
      <div className="panel-heading">
        <div>
          <div className="panel-eyebrow">Library</div>
          <h2 className="panel-title">Add a node</h2>
        </div>
        <Blocks size={16} aria-hidden="true" />
      </div>
      <label className="search-field">
        <Search aria-hidden="true" />
        <span className="sr-only">Search nodes</span>
        <input
          ref={searchInputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search nodes"
          autoComplete="off"
        />
        <span className="search-key" aria-hidden="true">
          /
        </span>
      </label>
      <div className="operator-groups">
        {groups.map(({ category, definitions }) => {
          const expanded = isSearching || expandedCategories.has(category.id);
          const headingId = `operator-category-${category.id}-heading`;
          const itemsId = `operator-category-${category.id}-items`;
          const CategoryIcon = category.icon;
          return (
            <section
              className="operator-group"
              id={`operator-category-${category.id}`}
              data-category-id={category.id}
              aria-labelledby={headingId}
              key={category.id}
            >
              <h3 className="operator-group-title">
                <button
                  type="button"
                  className="operator-group-toggle"
                  id={headingId}
                  aria-label={category.label}
                  aria-expanded={expanded}
                  aria-controls={itemsId}
                  disabled={isSearching}
                  title={category.summary}
                  onClick={() => toggleCategory(category.id)}
                >
                  <span className="operator-category-icon" aria-hidden="true">
                    <CategoryIcon />
                  </span>
                  <span className="operator-category-label">
                    {category.label}
                  </span>
                  <span className="operator-category-count" aria-hidden="true">
                    {definitions.length}
                  </span>
                  <ChevronDown
                    className="operator-category-chevron"
                    aria-hidden="true"
                  />
                </button>
              </h3>
              <div
                className="operator-group-items"
                id={itemsId}
                role="group"
                aria-labelledby={headingId}
                hidden={!expanded}
              >
                {definitions.map((definition) => (
                  <OperatorTile
                    key={definition.kind}
                    definition={definition}
                    onAdd={onAdd}
                  />
                ))}
              </div>
            </section>
          );
        })}
        {groups.length === 0 ? (
          <p className="empty-filter">
            No nodes match “{query}”. Try a category, node, or function.
          </p>
        ) : null}
      </div>
      <div className="library-footnote">Click a node to place it near the center of the patch.</div>
    </aside>
  );
}

function OperatorTile({
  definition,
  onAdd,
}: {
  definition: OperatorDefinition;
  onAdd: (kind: NodeKind) => void;
}) {
  const meta = OPERATOR_META[definition.kind];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      className="operator-tile"
      style={{ '--node-accent': meta.accent } as React.CSSProperties}
      onClick={() => onAdd(definition.kind)}
      title={`Add ${definition.title}`}
    >
      <span className="operator-icon" aria-hidden="true">
        <Icon />
      </span>
      <span className="operator-copy">
        <span className="operator-name">{definition.title}</span>
        <span className="operator-description">{definition.summary}</span>
      </span>
      <span className="operator-add" aria-hidden="true">+</span>
    </button>
  );
}
