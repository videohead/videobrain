import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { GRAPH_PRESETS } from '../graph';
import { NewPatchMenu } from './NewPatchMenu';

describe('NewPatchMenu', () => {
  it('reveals every starter and selects one by id', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<NewPatchMenu onSelect={onSelect} />);

    const trigger = screen.getByRole('button', { name: 'New patch' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('menu', { name: 'New patch starters' }),
    ).toBeVisible();
    expect(screen.getAllByRole('menuitem')).toHaveLength(GRAPH_PRESETS.length);
    expect(
      screen.getByRole('menuitem', { name: /Blank Canvas/ }),
    ).toHaveFocus();

    await user.click(
      screen.getByRole('menuitem', { name: /Pointer Bend/ }),
    );

    expect(onSelect).toHaveBeenCalledWith('pointer-bend');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('supports arrow, boundary, and Escape keyboard controls', async () => {
    const user = userEvent.setup();
    render(<NewPatchMenu onSelect={() => undefined} />);

    const trigger = screen.getByRole('button', { name: 'New patch' });
    trigger.focus();
    await user.keyboard('{ArrowUp}');
    expect(
      screen.getByRole('menuitem', { name: /Local File Preview/ }),
    ).toHaveFocus();

    await user.keyboard('{Home}');
    expect(
      screen.getByRole('menuitem', { name: /Blank Canvas/ }),
    ).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(
      screen.getByRole('menuitem', { name: /Full Studio/ }),
    ).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('moves Tab focus to adjacent visible toolbar controls', async () => {
    const user = userEvent.setup();
    render(
      <header className="topbar">
        <button type="button">Previous action</button>
        <NewPatchMenu onSelect={() => undefined} />
        <button type="button" style={{ display: 'none' }}>
          Hidden action
        </button>
        <button type="button">Next action</button>
      </header>,
    );

    const trigger = screen.getByRole('button', { name: 'New patch' });
    await user.click(trigger);
    await user.tab();
    expect(
      screen.getByRole('button', { name: 'Next action' }),
    ).toHaveFocus();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    trigger.focus();
    await user.keyboard('{ArrowDown}');
    await user.tab({ shift: true });
    expect(
      screen.getByRole('button', { name: 'Previous action' }),
    ).toHaveFocus();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes when focus moves outside the menu', async () => {
    const user = userEvent.setup();
    render(
      <>
        <NewPatchMenu onSelect={() => undefined} />
        <button type="button">Outside action</button>
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'New patch' }));
    await user.click(screen.getByRole('button', { name: 'Outside action' }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
