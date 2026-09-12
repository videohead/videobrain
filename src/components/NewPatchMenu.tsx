import { useEffect, useId, useRef, useState } from 'react';
import { FilePlus2 } from 'lucide-react';

import { GRAPH_PRESETS, type GraphPresetId } from '../graph';

interface NewPatchMenuProps {
  onSelect: (presetId: GraphPresetId) => void;
}

function isVisible(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current) {
    const style = window.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
    current = current.parentElement;
  }
  return true;
}

export function NewPatchMenu({ onSelect }: NewPatchMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  const openMenu = (index: number) => {
    setActiveIndex(index);
    setOpen(true);
  };

  const closeAndRestoreFocus = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    itemRefs.current[activeIndex]?.focus();
    const closeFromPointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const closeFromFocus = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeFromPointer);
    document.addEventListener('focusin', closeFromFocus);
    return () => {
      document.removeEventListener('pointerdown', closeFromPointer);
      document.removeEventListener('focusin', closeFromFocus);
    };
  }, [activeIndex, open]);

  const focusItem = (index: number) => {
    const normalized =
      (index + GRAPH_PRESETS.length) % GRAPH_PRESETS.length;
    setActiveIndex(normalized);
    itemRefs.current[normalized]?.focus();
  };

  const focusAdjacentToolbarControl = (direction: -1 | 1) => {
    const topbar = rootRef.current?.closest<HTMLElement>('.topbar');
    const trigger = buttonRef.current;
    if (!topbar || !trigger) {
      closeAndRestoreFocus();
      return;
    }

    const controls = Array.from(
      topbar.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    ).filter(
      (control) =>
        !control.closest('[role="menu"]') && isVisible(control),
    );
    const triggerIndex = controls.indexOf(trigger);
    const target = controls[triggerIndex + direction];
    setOpen(false);
    (target ?? trigger).focus();
  };

  return (
    <div className="new-patch-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="icon-button"
        title="New patch"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            openMenu(0);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            openMenu(0);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu(GRAPH_PRESETS.length - 1);
          }
        }}
      >
        <FilePlus2 size={14} />
        <span className="sr-only">New patch</span>
      </button>

      {open ? (
        <div
          className="new-patch-popover"
          id={menuId}
          role="menu"
          aria-label="New patch starters"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closeAndRestoreFocus();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              focusItem(activeIndex + 1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              focusItem(activeIndex - 1);
            } else if (event.key === 'Home') {
              event.preventDefault();
              focusItem(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              focusItem(GRAPH_PRESETS.length - 1);
            } else if (event.key === 'Tab') {
              event.preventDefault();
              focusAdjacentToolbarControl(event.shiftKey ? -1 : 1);
            }
          }}
        >
          <div className="new-patch-heading" role="presentation">
            Start a new patch
          </div>
          {GRAPH_PRESETS.map((preset, index) => (
            <button
              key={preset.id}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              className="new-patch-item"
              role="menuitem"
              tabIndex={index === activeIndex ? 0 : -1}
              onFocus={() => setActiveIndex(index)}
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
                onSelect(preset.id);
              }}
            >
              <strong>{preset.title}</strong>
              <span>{preset.description}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
