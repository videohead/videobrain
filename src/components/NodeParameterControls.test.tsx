import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  getDefaultParams,
  getOperatorDefinition,
  type NodeKind,
} from '../graph';
import { NodeParameterControls } from './NodeParameterControls';

function renderControls(kind: NodeKind) {
  const definition = getOperatorDefinition(kind);
  const props = {
    nodeId: `${kind}-1`,
    definition,
    params: getDefaultParams(kind),
    onParamChange: vi.fn(),
    onGestureStart: vi.fn(),
    onGestureEnd: vi.fn(),
    onSelect: vi.fn(),
  };
  render(<NodeParameterControls {...props} />);
  return props;
}

describe('NodeParameterControls', () => {
  it('renders every numeric value as a compact node-safe slider', () => {
    renderControls('oscillator');

    expect(
      screen.getByRole('group', { name: 'Oscillator parameters' }),
    ).toBeVisible();
    const sliders = screen.getAllByRole('slider');
    expect(sliders).toHaveLength(4);
    expect(sliders[0]).toHaveClass('nodrag', 'nopan', 'nowheel');
    expect(screen.getByRole('combobox', { name: 'Oscillator Waveform' })).toBeVisible();
  });

  it('updates a numeric parameter inside one undo gesture', () => {
    const props = renderControls('oscillator');
    const slider = screen.getByRole('slider', { name: 'Oscillator Frequency' });

    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '2.5' } });
    fireEvent.pointerUp(slider);

    expect(props.onSelect).toHaveBeenCalled();
    expect(props.onGestureStart).toHaveBeenCalledOnce();
    expect(props.onParamChange).toHaveBeenCalledWith(
      'oscillator-1',
      'frequency',
      2.5,
    );
    expect(props.onGestureEnd).toHaveBeenCalledOnce();
  });

  it('gives each analysis band a draggable frequency and Q handle beside its sliders', () => {
    const props = renderControls('audioSpectrum');

    for (const band of ['Bass', 'Mid', 'Treble']) {
      expect(
        screen.getByRole('button', {
          name: `Audio Spectrum ${band} frequency and Q`,
        }),
      ).toBeVisible();
      expect(
        screen.getByRole('slider', { name: `Audio Spectrum ${band} Hz` }),
      ).toBeVisible();
      expect(
        screen.getByRole('slider', { name: `Audio Spectrum ${band} Q` }),
      ).toBeVisible();
    }

    const handle = screen.getByRole('button', {
      name: 'Audio Spectrum Treble frequency and Q',
    });
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    fireEvent.keyUp(handle, { key: 'ArrowUp' });

    expect(props.onGestureStart).toHaveBeenCalledOnce();
    expect(props.onParamChange).toHaveBeenCalledWith(
      'audioSpectrum-1',
      'trebleQ',
      0.75,
    );
    expect(props.onGestureEnd).toHaveBeenCalledOnce();
  });

  it('exposes enumerated node values as compact selects', async () => {
    const user = userEvent.setup();
    const props = renderControls('videoInput');

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Video Input Fit' }),
      'contain',
    );

    expect(props.onParamChange).toHaveBeenCalledWith(
      'videoInput-1',
      'fit',
      'contain',
    );
  });

  it('keeps multiline prompt editing inside one undo gesture', () => {
    const props = renderControls('aiPrompt');
    const prompt = screen.getByRole('textbox', { name: 'AI Chat Prompt' });

    fireEvent.focus(prompt);
    fireEvent.change(prompt, {
      target: { value: 'Amber light folding through glass' },
    });
    fireEvent.blur(prompt);

    expect(prompt).toHaveAttribute('maxlength', '4000');
    expect(props.onSelect).toHaveBeenCalled();
    expect(props.onGestureStart).toHaveBeenCalledOnce();
    expect(props.onParamChange).toHaveBeenCalledWith(
      'aiPrompt-1',
      'text',
      'Amber light folding through glass',
    );
    expect(props.onGestureEnd).toHaveBeenCalledOnce();
  });

  it('renders the complete beat clock as live in-node sliders', () => {
    renderControls('beatClock');

    expect(screen.getByRole('slider', { name: 'Beat Clock BPM' })).toBeVisible();
    expect(
      screen.getByRole('slider', { name: 'Beat Clock Beats / bar' }),
    ).toBeVisible();
    expect(
      screen.getByRole('slider', { name: 'Beat Clock Pulse width' }),
    ).toBeVisible();
    expect(
      screen.getByRole('slider', { name: 'Beat Clock Beat offset' }),
    ).toBeVisible();
  });

  it('maps a two-axis pointer gesture to normalized X and Y values', () => {
    const props = renderControls('xyPad');
    const pad = screen.getByRole('button', { name: 'XY Pad Position' });
    expect(screen.getByRole('slider', { name: 'XY Pad X' })).toBeVisible();
    expect(screen.getByRole('slider', { name: 'XY Pad Y' })).toBeVisible();
    vi.spyOn(pad, 'getBoundingClientRect').mockReturnValue({
      bottom: 120,
      height: 100,
      left: 20,
      right: 220,
      top: 20,
      width: 200,
      x: 20,
      y: 20,
      toJSON: () => ({}),
    });
    Object.assign(pad, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    });

    fireEvent.pointerDown(pad, {
      button: 0,
      clientX: 60,
      clientY: 40,
      pointerId: 7,
    });
    fireEvent.pointerMove(pad, {
      clientX: 180,
      clientY: 100,
      pointerId: 7,
    });
    fireEvent.pointerUp(pad, {
      button: 0,
      clientX: 180,
      clientY: 100,
      pointerId: 7,
    });

    expect(props.onSelect).toHaveBeenCalled();
    expect(props.onGestureStart).toHaveBeenCalledOnce();
    expect(props.onParamChange).toHaveBeenCalledWith('xyPad-1', 'x', 0.8);
    expect(props.onParamChange).toHaveBeenCalledWith('xyPad-1', 'y', 0.2);
    expect(props.onGestureEnd).toHaveBeenCalledOnce();
  });

  it('supports fine and coarse keyboard changes on the two-axis surface', () => {
    const props = renderControls('xyPad');
    const pad = screen.getByRole('button', { name: 'XY Pad Position' });

    fireEvent.keyDown(pad, { key: 'ArrowRight' });
    fireEvent.keyUp(pad, { key: 'ArrowRight' });
    fireEvent.keyDown(pad, { key: 'ArrowUp', shiftKey: true });
    fireEvent.keyUp(pad, { key: 'ArrowUp', shiftKey: true });

    expect(props.onParamChange).toHaveBeenCalledWith('xyPad-1', 'x', 0.51);
    expect(props.onParamChange).toHaveBeenCalledWith('xyPad-1', 'y', 0.6);
    expect(props.onGestureStart).toHaveBeenCalledTimes(2);
    expect(props.onGestureEnd).toHaveBeenCalledTimes(2);
  });

  it('keeps a multi-key XY edit inside one undo gesture', () => {
    const props = renderControls('xyPad');
    const pad = screen.getByRole('button', { name: 'XY Pad Position' });

    fireEvent.keyDown(pad, { key: 'ArrowRight' });
    fireEvent.keyDown(pad, { key: 'ArrowUp' });
    fireEvent.keyUp(pad, { key: 'ArrowRight' });
    expect(props.onGestureEnd).not.toHaveBeenCalled();
    fireEvent.keyDown(pad, { key: 'ArrowUp', repeat: true });
    fireEvent.keyUp(pad, { key: 'ArrowUp' });

    expect(props.onGestureStart).toHaveBeenCalledOnce();
    expect(props.onGestureEnd).toHaveBeenCalledOnce();
  });
});
