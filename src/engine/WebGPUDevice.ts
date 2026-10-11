export type WebGPUFailureCode = 'unsupported' | 'limits' | 'initialization' | 'cancelled' | 'device-lost';

export class WebGPUError extends Error {
  constructor(readonly code: WebGPUFailureCode, message: string) {
    super(message);
    this.name = 'WebGPUError';
  }
}

export interface WebGPURequirements {
  features?: readonly GPUFeatureName[];
  limits?: Readonly<Record<string, number>>;
}

export interface WebGPUDeviceSession {
  readonly device: GPUDevice;
  readonly backend: 'webgpu';
  readonly lost: boolean;
  dispose(): void;
}

export interface WebGPUDeviceOptions {
  gpu?: GPU;
  secureContext?: boolean;
  signal?: AbortSignal;
  requirements?: WebGPURequirements;
  onError?: (error: WebGPUError) => void;
}

function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new WebGPUError('cancelled', 'WebGPU initialization was cancelled.');
}

export function validateWebGPULimits(limits: GPUSupportedLimits, required: Readonly<Record<string, number>>): void {
  for (const [name, value] of Object.entries(required)) {
    const available: unknown = Reflect.get(limits, name);
    if (!Number.isSafeInteger(value) || value < 0 || typeof available !== 'number') {
      throw new WebGPUError('limits', `Invalid or unknown WebGPU limit: ${name}.`);
    }
    const alignment = name === 'minUniformBufferOffsetAlignment' || name === 'minStorageBufferOffsetAlignment';
    if (alignment ? available > value : available < value) {
      throw new WebGPUError('limits', `WebGPU limit ${name}: required ${value}, available ${available}.`);
    }
  }
}

export async function acquireWebGPUDevice(options: WebGPUDeviceOptions = {}): Promise<WebGPUDeviceSession> {
  const secure = options.secureContext ?? globalThis.isSecureContext;
  const gpu = options.gpu ?? globalThis.navigator?.gpu;
  if (!secure || !gpu) throw new WebGPUError('unsupported', 'WebGPU requires a compatible browser and GPU in a secure context (HTTPS or localhost). No WebGL fallback is available.');
  assertNotCancelled(options.signal);
  let device: GPUDevice | undefined;
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    assertNotCancelled(options.signal);
    if (!adapter) throw new WebGPUError('unsupported', 'No WebGPU adapter is available. Check browser graphics settings, GPU drivers, and system support.');
    const features = [...new Set(options.requirements?.features ?? [])];
    const limits = { ...options.requirements?.limits };
    for (const feature of features) {
      if (!adapter.features.has(feature)) throw new WebGPUError('unsupported', `Required WebGPU feature is unavailable: ${feature}.`);
    }
    validateWebGPULimits(adapter.limits, limits);
    device = await adapter.requestDevice({ requiredFeatures: features, requiredLimits: limits });
    assertNotCancelled(options.signal);
    validateWebGPULimits(device.limits, limits);
    let disposed = false;
    let lost = false;
    const acquired = device;
    const uncaptured = (event: GPUUncapturedErrorEvent) => {
      if (!disposed) options.onError?.(new WebGPUError('initialization', `WebGPU error: ${event.error.message}`));
    };
    acquired.addEventListener('uncapturederror', uncaptured);
    void acquired.lost.then((info) => {
      lost = true;
      if (!disposed) options.onError?.(new WebGPUError('device-lost', `WebGPU device lost (${info.reason}): ${info.message || 'Reinitialize the GPU runtime to continue.'}`));
    });
    return {
      backend: 'webgpu', device: acquired,
      get lost() { return lost; },
      dispose() {
        if (disposed) return;
        disposed = true;
        acquired.removeEventListener('uncapturederror', uncaptured);
        acquired.destroy();
      },
    };
  } catch (error) {
    device?.destroy();
    if (error instanceof WebGPUError) throw error;
    throw new WebGPUError('initialization', `WebGPU initialization failed: ${error instanceof Error ? error.message : 'Unknown device error.'}`);
  }
}