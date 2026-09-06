import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HelpDialog } from './HelpDialog';

describe('HelpDialog', () => {
  it('explains the live graph and links to contribution resources', () => {
    render(<HelpDialog onClose={() => undefined} />);

    expect(
      screen.getByRole('dialog', { name: 'Explore the Signal Graph' }),
    ).toBeVisible();
    expect(screen.getByText('Four signal types, one graph')).toBeVisible();
    expect(screen.getByText('Starter patches')).toBeVisible();
    expect(screen.getByText('Blank Canvas')).toBeVisible();
    expect(screen.getByText('Beat-Synced Color')).toBeVisible();
    expect(screen.getByText('Control Math')).toBeVisible();
    expect(screen.getByText('Smooth Pointer')).toBeVisible();
    expect(screen.getByText('Transform Playground')).toBeVisible();
    expect(screen.getByText('Mask & Composite Lab')).toBeVisible();
    expect(screen.getByText('Beat Switcher')).toBeVisible();
    expect(screen.getByText('Live Cut Lab')).toBeVisible();
    expect(screen.getByText('Audio Soft Focus')).toBeVisible();
    expect(screen.getByText('Spiral Feedback Lab')).toBeVisible();
    expect(screen.getByText(/every current node appears on a reachable branch/)).toBeVisible();
    expect(screen.getByText('Camera Dream')).toBeVisible();
    expect(screen.getByText(/Starting any new patch stops active camera/)).toBeVisible();
    expect(screen.getByText('Nodes available now')).toBeVisible();
    expect(screen.getByText('Flow Field')).toBeVisible();
    expect(screen.getByText('AI Chat')).toBeVisible();
    expect(screen.getByText('Video Model')).toBeVisible();
    expect(screen.getByText('Solid Color')).toBeVisible();
    expect(screen.getByText('Frame Switch')).toBeVisible();
    expect(screen.getByText('Spiral Feedback')).toBeVisible();
    expect(screen.getByText('Auto Selector')).toBeVisible();
    expect(screen.getByText('Strobe', { exact: true })).toBeVisible();
    expect(
      screen.getByText('Rotates and zooms retained history into a spiralling frame.'),
    ).toBeVisible();
    expect(
      screen.getByText('A hands-on pair of normalized control signals.'),
    ).toBeVisible();
    expect(screen.getByText('Two-axis color control')).toBeVisible();
    expect(screen.getByText('Control arithmetic and mapping')).toBeVisible();
    expect(screen.getByText('Smoothed pointer motion')).toBeVisible();
    expect(screen.getByText('Two-dimensional transform controls')).toBeVisible();
    expect(screen.getByText('Seventeen patches to try')).toBeVisible();
    expect(screen.getByText('Mask and composite fundamentals')).toBeVisible();
    expect(screen.getByText('Tempo-locked source switching')).toBeVisible();
    expect(
      screen.getByText('Automatic live cuts (flashing imagery)'),
    ).toBeVisible();
    expect(
      screen.getByText(/seeded shuffle bag visits all four sources/),
    ).toBeVisible();
    expect(screen.getByText(/Photosensitivity warning:/)).toBeVisible();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent
            ?.replace(/\s+/g, ' ')
            .includes('connected Phase signal overrides Rate') === true,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/limit does not make flashing upstream media safe/),
    ).toBeVisible();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent
            ?.replace(/\s+/g, ' ')
            .includes('set Amount to 0') === true,
      ),
    ).toBeVisible();
    expect(screen.getByText('Audio-controlled soft focus')).toBeVisible();
    expect(screen.getByText('Audio-reactive trails')).toBeVisible();
    expect(
      screen.getByText('Bass impulses and an implied beat clock'),
    ).toBeVisible();
    expect(
      screen.getByText(/infers tempo from the spacing between those triggers/),
    ).toBeVisible();
    expect(screen.getByText('Spiralling recursive image')).toBeVisible();
    expect(
      screen.getByText(/Return to frame zero discards and deterministically re-seeds history/),
    ).toBeVisible();
    expect(
      screen.getByText(/replace Cells with Video Input and explicitly start the camera/),
    ).toBeVisible();
    expect(screen.getByText('Beat-locked motion')).toBeVisible();
    expect(screen.getByText('Model connector preview')).toBeVisible();
    expect(screen.getByText('AI Chat and Video Model')).toBeVisible();
    expect(screen.getByText(/entering an arbitrary vendor URL/)).toBeVisible();
    expect(screen.getByText('Using Audio Level')).toBeVisible();
    expect(
      screen.getByText(/Audio Level owns the microphone\./),
    ).toBeVisible();
    expect(screen.getByText(/Flow Field · Energy/)).toBeVisible();
    expect(screen.getByText(/Floor rejects.*Gain controls/)).toBeVisible();
    expect(screen.getByText('Using Video Input')).toBeVisible();
    expect(screen.getByText('Using File audio')).toBeVisible();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent
            ?.replace(/\s+/g, ' ')
            .includes('connect Frame to Display Source') === true,
      ),
    ).toBeVisible();
    expect(screen.getByText('Not built yet')).toBeVisible();
    expect(screen.getByText('Control and mapping')).toBeVisible();
    expect(screen.getByText('Vision and spatial media')).toBeVisible();
    expect(
      screen.getByRole('link', { name: /comprehensive node and module plan/ }),
    ).toHaveAttribute(
      'href',
      'https://github.com/blechdom/videobrain/blob/main/docs/FUTURE_DEVELOPMENT.md',
    );
    expect(screen.getByText(/Display sync follows/)).toBeVisible();
    expect(
      screen.getByRole('link', { name: /model adapter protocol/ }),
    ).toHaveAttribute(
      'href',
      'https://github.com/blechdom/videobrain/blob/main/docs/MODEL_CONNECTORS.md',
    );
    expect(screen.getByRole('link', { name: /Full roadmap/ })).toHaveAttribute(
      'href',
      'https://github.com/blechdom/videobrain/blob/main/docs/FUTURE_DEVELOPMENT.md',
    );
    expect(
      screen.getByRole('link', { name: /Component catalog/ }),
    ).toHaveAttribute('href', 'https://videobrain.org/storybook/');
    expect(screen.getByRole('link', { name: /Contribute on GitHub/ })).toHaveAttribute(
      'href',
      'https://github.com/blechdom/videobrain',
    );
  });

  it('closes from its close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HelpDialog onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Close help' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes with Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HelpDialog onClose={onClose} />);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps backward keyboard navigation inside the dialog', async () => {
    const user = userEvent.setup();
    render(<HelpDialog onClose={() => undefined} />);

    expect(
      screen.getByRole('dialog', { name: 'Explore the Signal Graph' }),
    ).toHaveFocus();
    await user.tab({ shift: true });

    expect(
      screen.getByRole('link', { name: /Contribute on GitHub/ }),
    ).toHaveFocus();
  });
});
