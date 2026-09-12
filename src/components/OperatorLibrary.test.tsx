import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  NODE_KINDS,
  OPERATOR_CATEGORY_IDS,
  OPERATOR_DEFINITIONS,
} from '../graph';
import { OPERATOR_CATEGORIES } from './operatorCategories';
import { OperatorLibrary } from './OperatorLibrary';

describe('OperatorLibrary', () => {
  it('groups every node under a stable, collapsible functional category', () => {
    render(<OperatorLibrary onAdd={() => undefined} />);

    expect(OPERATOR_DEFINITIONS.map(({ kind }) => kind)).toEqual(NODE_KINDS);
    expect(OPERATOR_CATEGORIES.map(({ id }) => id)).toEqual(
      OPERATOR_CATEGORY_IDS,
    );

    for (const category of OPERATOR_CATEGORIES) {
      const toggle = screen.getByRole('button', { name: category.label });
      expect(toggle).toHaveAttribute(
        'aria-controls',
        `operator-category-${category.id}-items`,
      );
    }

    expect(screen.getByRole('button', { name: 'Inputs' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Generators' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Timing' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByTitle('Add Video Input')).toBeVisible();
    expect(screen.getByTitle('Add Flow Field')).toBeVisible();
    expect(screen.getByTitle('Add Transport Time')).not.toBeVisible();
  });

  it('expands a category and keeps node placement to one click', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<OperatorLibrary onAdd={onAdd} />);

    const timing = screen.getByRole('button', { name: 'Timing' });
    await user.click(timing);

    expect(timing).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTitle('Add Auto Selector')).toBeVisible();
    await user.click(screen.getByTitle('Add Transport Time'));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onAdd).toHaveBeenCalledWith('time');

    await user.click(timing);
    expect(timing).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTitle('Add Transport Time')).not.toBeVisible();
  });

  it('searches category names and automatically reveals matching nodes', async () => {
    const user = userEvent.setup();
    render(<OperatorLibrary onAdd={() => undefined} />);

    const search = screen.getByRole('textbox', { name: 'Search nodes' });
    await user.type(search, 'compositing');

    const compositing = screen.getByRole('button', { name: 'Compositing' });
    expect(compositing).toHaveAttribute('aria-expanded', 'true');
    expect(compositing).toBeDisabled();
    expect(screen.getByTitle('Add Mask')).toBeVisible();
    expect(screen.getByTitle('Add Composite')).toBeVisible();
    expect(screen.getByTitle('Add Frame Switch')).toBeVisible();
    expect(screen.getByTitle('Add Blend')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Timing' })).not.toBeInTheDocument();

    await user.clear(search);
    expect(screen.getByRole('button', { name: 'Compositing' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    await user.type(search, 'threshold');
    expect(screen.getByRole('button', { name: 'Image Processing' })).toBeVisible();
    expect(screen.getByTitle('Add Threshold')).toBeVisible();
    expect(screen.queryByTitle('Add Blur')).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'spiral');
    expect(screen.getByRole('button', { name: 'Image Processing' })).toBeVisible();
    expect(screen.getByTitle('Add Spiral Feedback')).toBeVisible();

    await user.clear(search);
    await user.type(search, 'strobe');
    expect(screen.getByRole('button', { name: 'Image Processing' })).toBeVisible();
    expect(screen.getByTitle('Add Strobe')).toBeVisible();
  });
});
