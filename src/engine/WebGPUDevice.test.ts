import { describe, expect, it, vi } from 'vitest';
import { acquireWebGPUDevice, validateWebGPULimits } from './WebGPUDevice';

function fixture() {
  let lose: (info: GPUDeviceLostInfo) => void = () => undefined;
  const limits = { maxTextureDimension2D: 2048, maxBufferSize: 1048576, minUniformBufferOffsetAlignment: 256 } as GPUSupportedLimits;
  const destroy = vi.fn();
  const device = Object.assign(new EventTarget(), {
    limits, destroy, lost: new Promise<GPUDeviceLostInfo>((resolve) => { lose = resolve; }),
  }) as unknown as GPUDevice;
  const requestDevice = vi.fn().mockResolvedValue(device);
  const requestAdapter = vi.fn().mockResolvedValue({ limits, features: new Set(['timestamp-query']), requestDevice });
  const gpu = { requestAdapter } as unknown as GPU;
  return { gpu, device, destroy, limits, requestDevice, requestAdapter, lose };
}

describe('strict WebGPU device lifecycle', () => {
  it('rejects insecure contexts without requesting an adapter', async () => {
    const { gpu, requestAdapter } = fixture();
    await expect(acquireWebGPUDevice({ gpu, secureContext: false })).rejects.toMatchObject({ code: 'unsupported' });
    expect(requestAdapter).not.toHaveBeenCalled();
  });
  it('requests only declared features and limits and destroys exactly once', async () => {
    const { gpu, destroy, requestDevice } = fixture();
    const session = await acquireWebGPUDevice({ gpu, secureContext: true, requirements: { limits: { maxTextureDimension2D: 2048 } } });
    expect(requestDevice).toHaveBeenCalledWith({ requiredFeatures: [], requiredLimits: { maxTextureDimension2D: 2048 } });
    expect(session.backend).toBe('webgpu');
    session.dispose(); session.dispose();
    expect(destroy).toHaveBeenCalledOnce();
  });
  it('rejects unavailable adapters, features, and limits without fallback', async () => {
    const { gpu, requestAdapter, requestDevice } = fixture();
    await expect(acquireWebGPUDevice({ gpu, secureContext: true, requirements: { features: ['shader-f16'] } })).rejects.toMatchObject({ code: 'unsupported' });
    await expect(acquireWebGPUDevice({ gpu, secureContext: true, requirements: { limits: { maxBufferSize: 2097152 } } })).rejects.toMatchObject({ code: 'limits' });
    expect(requestDevice).not.toHaveBeenCalled();
    requestAdapter.mockResolvedValue(null);
    await expect(acquireWebGPUDevice({ gpu, secureContext: true })).rejects.toMatchObject({ code: 'unsupported' });
    expect(requestAdapter).toHaveBeenCalledTimes(3);
  });
  it('destroys a device returned after cancellation', async () => {
    const { gpu, device, destroy, requestDevice } = fixture();
    const cancellation = new AbortController();
    requestDevice.mockImplementation(() => { cancellation.abort(); return Promise.resolve(device); });
    await expect(acquireWebGPUDevice({ gpu, secureContext: true, signal: cancellation.signal })).rejects.toMatchObject({ code: 'cancelled' });
    expect(destroy).toHaveBeenCalledOnce();
  });
  it('surfaces device loss but suppresses callbacks after disposal', async () => {
    const first = fixture(); const onError = vi.fn();
    const session = await acquireWebGPUDevice({ gpu: first.gpu, secureContext: true, onError });
    first.lose({ reason: 'unknown', message: 'fixture loss' } as GPUDeviceLostInfo);
    await Promise.resolve();
    expect(session.lost).toBe(true);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'device-lost' }));
    session.dispose();
    const second = fixture(); onError.mockClear();
    const disposed = await acquireWebGPUDevice({ gpu: second.gpu, secureContext: true, onError });
    disposed.dispose(); second.lose({ reason: 'destroyed', message: '' } as GPUDeviceLostInfo);
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });
  it('handles alignment limits in the opposite direction from capacity limits', () => {
    const { limits } = fixture();
    expect(() => validateWebGPULimits(limits, { minUniformBufferOffsetAlignment: 256 })).not.toThrow();
    expect(() => validateWebGPULimits(limits, { minUniformBufferOffsetAlignment: 128 })).toThrow();
    expect(() => validateWebGPULimits(limits, { nonexistent: 1 })).toThrow();
  });
});