import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SceneAssetControl } from './SceneAssetControl';

const HASH = 'a'.repeat(64);

function makeFile(name = 'model.glb'): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type: 'model/gltf-binary' });
}

describe('SceneAssetControl', () => {
  it('shows the no-model state and disables remove', () => {
    render(
      <SceneAssetControl
        assetId=""
        assetHash=""
        status="none"
        onImport={vi.fn()}
        onApply={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText('No model imported')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove model' })).toHaveProperty('disabled', true);
  });

  it('imports a file and applies the returned asset ref', async () => {
    const onImport = vi.fn(() => Promise.resolve({ ok: true as const, assetId: 'id-1', assetHash: HASH }));
    const onApply = vi.fn();
    render(
      <SceneAssetControl
        assetId=""
        assetHash=""
        status="none"
        onImport={onImport}
        onApply={onApply}
        onClear={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('Import 3D model asset');
    fireEvent.change(input, { target: { files: [makeFile()] } });

    await waitFor(() => expect(onApply).toHaveBeenCalledWith('id-1', HASH));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('surfaces an import error without applying', async () => {
    const onImport = vi.fn(() => Promise.resolve({ ok: false as const, error: 'Bad model.' }));
    const onApply = vi.fn();
    render(
      <SceneAssetControl
        assetId=""
        assetHash=""
        status="none"
        onImport={onImport}
        onApply={onApply}
        onClear={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Import 3D model asset'), { target: { files: [makeFile()] } });

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Bad model.'));
    expect(onApply).not.toHaveBeenCalled();
  });

  it('shows the relink affordance when the asset is missing', () => {
    render(
      <SceneAssetControl
        assetId="id-1"
        assetHash={HASH}
        status="missing"
        onImport={vi.fn()}
        onApply={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText('Model missing — relink')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Relink model' })).toBeTruthy();
  });

  it('clears the asset on remove', () => {
    const onClear = vi.fn();
    render(
      <SceneAssetControl
        assetId="id-1"
        assetHash={HASH}
        status="ready"
        onImport={vi.fn()}
        onApply={vi.fn()}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove model' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
