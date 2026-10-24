import { useEffect, useId, useRef, useState } from 'react';
import {
  CircleHelp,
  Download,
  FilePlus2,
  LayoutDashboard,
  Menu,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react';
import {
  GRAPH_PRESETS,
  type GraphPresetId,
} from '../graph';
import { NodeSearch, type SearchableGraphNode } from './NodeSearch';

interface MobileMenuProps {
  playing: boolean;
  canUndo: boolean;
  canRedo: boolean;
  nodes: SearchableGraphNode[];
  onTogglePlaying: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onNew: (presetId: GraphPresetId) => void;
  onImport: () => void;
  onExport: () => void;
  onAdd: () => void;
  onControllers: () => void;
  onOutputLayouts: () => void;
  onHelp: () => void;
  onNodeSelect: (nodeId: string) => void;
}

export function MobileMenu({
  playing,
  canUndo,
  canRedo,
  nodes,
  onTogglePlaying,
  onUndo,
  onRedo,
  onNew,
  onImport,
  onExport,
  onAdd,
  onControllers,
  onOutputLayouts,
  onHelp,
  onNodeSelect,
}: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const presetMenuId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = 'hidden';

    const frame = window.requestAnimationFrame(() => {
      searchRef.current?.focus();
    });

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setPresetOpen(false);
    triggerRef.current?.focus();
  };

  const run = (action: () => void) => {
    action();
    close();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="icon-button mobile-menu-trigger"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="mobile-menu-panel"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X size={16} /> : <Menu size={16} />}
        <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
      </button>

      {open ? (
        <div
          className="mobile-menu-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              close();
            }
          }}
        >
          <div
            id="mobile-menu-panel"
            className="mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
          >
            <div className="mobile-menu-header">
              <span className="mobile-menu-title">
                <span className="brand-mark" aria-hidden="true">
                  <svg viewBox="0 0 36 36">
                    <path d="M3 21h5l3-10 5 19 4-25 4 16h9" fill="none" stroke="#d8ff5f" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="3" cy="21" r="1.8" fill="#ff795c" />
                    <circle cx="33" cy="21" r="1.8" fill="#65ddff" />
                  </svg>
                </span>
                VideoBrain
              </span>
              <button
                type="button"
                className="icon-button"
                onClick={close}
                aria-label="Close menu"
              >
                <X size={15} />
                <span className="sr-only">Close menu</span>
              </button>
            </div>

            <div className="mobile-menu-body">
              <section className="mobile-menu-section" aria-label="Playback">
                <button
                  type="button"
                  className="mobile-menu-action primary"
                  onClick={() => run(onTogglePlaying)}
                >
                  {playing ? <Pause size={15} /> : <Play size={15} />}
                  {playing ? 'Pause patch' : 'Play patch'}
                </button>
                <div className="mobile-menu-row">
                  <button
                    type="button"
                    className="mobile-menu-action"
                    disabled={!canUndo}
                    onClick={() => run(onUndo)}
                  >
                    <RotateCcw size={14} /> Undo
                  </button>
                  <button
                    type="button"
                    className="mobile-menu-action"
                    disabled={!canRedo}
                    onClick={() => run(onRedo)}
                  >
                    <RotateCw size={14} /> Redo
                  </button>
                </div>
              </section>

              <section className="mobile-menu-section" aria-label="Project">
                <div className="mobile-menu-section-label">Project</div>
                <div className="new-patch-menu mobile-menu-patch">
                  <button
                    type="button"
                    className="mobile-menu-action"
                    aria-haspopup="menu"
                    aria-expanded={presetOpen}
                    aria-controls={presetOpen ? presetMenuId : undefined}
                    onClick={() => setPresetOpen((value) => !value)}
                  >
                    <FilePlus2 size={14} /> New patch
                  </button>
                  {presetOpen ? (
                    <div className="new-patch-popover mobile-menu-patch-popover" id={presetMenuId} role="menu" aria-label="New patch starters">
                      {GRAPH_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          className="new-patch-item"
                          role="menuitem"
                          onClick={() => run(() => onNew(preset.id))}
                        >
                          <strong>{preset.title}</strong>
                          <span>{preset.description}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="mobile-menu-action"
                  onClick={() => run(onImport)}
                >
                  <Upload size={14} /> Import project
                </button>
                <button
                  type="button"
                  className="mobile-menu-action"
                  onClick={() => run(onExport)}
                >
                  <Download size={14} /> Export project
                </button>
                <button
                  type="button"
                  className="mobile-menu-action"
                  onClick={() => run(onAdd)}
                >
                  <Plus size={14} /> Add node
                </button>
                <button
                  type="button"
                  className="mobile-menu-action"
                  onClick={() => run(onControllers)}
                >
                  <SlidersHorizontal size={14} /> Controllers
                </button>
                <button
                  type="button"
                  className="mobile-menu-action"
                  onClick={() => run(onOutputLayouts)}
                >
                  <LayoutDashboard size={14} /> Output Layouts
                </button>
                <button
                  type="button"
                  className="mobile-menu-action"
                  onClick={() => run(onHelp)}
                >
                  <CircleHelp size={14} /> Help & about
                </button>
              </section>

              <section className="mobile-menu-section" aria-label="Find a node in the patch">
                <div className="mobile-menu-section-label">
                  <Search size={11} aria-hidden="true" /> Find a node in this patch
                </div>
                <NodeSearch
                  inputRef={searchRef}
                  nodes={nodes}
                  onSelect={(nodeId) => {
                    onNodeSelect(nodeId);
                    close();
                  }}
                />
              </section>
            </div>

            <div className="mobile-menu-footer">
              {nodes.length} node{nodes.length === 1 ? '' : 's'} in this patch
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}