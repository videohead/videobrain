import Renderer from 'three/src/renderers/common/Renderer.js';
import WebGPUBackend from 'three/src/renderers/webgpu/WebGPUBackend.js';
import StandardNodeLibrary from 'three/src/renderers/webgpu/nodes/StandardNodeLibrary.js';
import { NoToneMapping, RGBAFormat, UnsignedByteType, LinearSRGBColorSpace } from 'three/src/constants.js';
import { RenderTarget } from 'three/src/core/RenderTarget.js';
import type { Scene } from 'three/src/scenes/Scene.js';
import type { Camera } from 'three/src/cameras/Camera.js';
import { acquireWebGPUDevice, WebGPUError, type WebGPUDeviceOptions, type WebGPUDeviceSession } from './WebGPUDevice';
import { getOperatorDefinition, type GraphParams } from '../graph';
import { WEBGPU_FRAME_EFFECTS, type WebGPUFrameEffectKind } from './WebGPUFrameEffects';

const MAX_FRAME_PIXELS = 1920 * 1080;
const MAX_FRAME_TARGETS = 20;
const MAX_FRAME_BYTES = MAX_FRAME_PIXELS * 4 * MAX_FRAME_TARGETS;

const FULLSCREEN = `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
  let position = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var output: VertexOutput;
  output.position = vec4f(position * 2.0 - 1.0, 0.0, 1.0);
  output.uv = vec2f(position.x, 1.0 - position.y);
  return output;
}
`;

const COLOR_PASS = `${FULLSCREEN}
struct Parameters { exposure: f32, saturation: f32, contrast: f32, unpremultiply: f32 }
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> parameters: Parameters;
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let sampled = textureSample(source, sourceSampler, input.uv);
  var color = sampled.rgb;
  if (parameters.unpremultiply > 0.5) {
    color = select(vec3f(0.0), color / max(sampled.a, 0.00001), sampled.a > 0.00001);
  }
  color *= exp2(parameters.exposure);
  let luminance = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  color = mix(vec3f(luminance), color, parameters.saturation);
  color = (color - 0.5) * parameters.contrast + 0.5;
  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), sampled.a);
}
`;

const PRESENT_PASS = `${FULLSCREEN}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(source, sourceSampler, input.uv);
  return vec4f(color.rgb * color.a, color.a);
}
`;

export interface WebGPUFrame {
  readonly width: number;
  readonly height: number;
  readonly format: 'rgba8unorm';
  readonly alpha: 'straight' | 'premultiplied';
}

interface FrameResource {
  texture: GPUTexture;
  sceneTarget?: RenderTarget;
  bytes: number;
}

export interface WebGPUColorParameters {
  exposure?: number;
  saturation?: number;
  contrast?: number;
}

export class WebGPUFrameRuntime {
  private readonly resources = new Map<WebGPUFrame, FrameResource>();
  private allocatedBytes = 0;
  private disposed = false;
  private readonly colorPipeline: GPURenderPipeline;
  private readonly presentPipeline: GPURenderPipeline;
  private readonly sampler: GPUSampler;
  private readonly parameters: GPUBuffer;
  private readonly context: GPUCanvasContext;
  private readonly canvasFormat: GPUTextureFormat;
  private failure: WebGPUError | null = null;
  private renderingScene = false;
  private draws = 0;
  private readonly effectPipelines = new Map<WebGPUFrameEffectKind, GPURenderPipeline>();
  private readonly effectParameters: GPUBuffer;
  private readonly emptyTexture: GPUTexture;
  private readonly effectLayout: GPUBindGroupLayout;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly session: WebGPUDeviceSession,
    private readonly renderer: Renderer,
    private readonly backend: WebGPUBackend,
  ) {
    const context = canvas.getContext('webgpu');
    if (!context) throw new WebGPUError('unsupported', 'A WebGPU canvas context is unavailable.');
    this.context = context;
    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: session.device, format: this.canvasFormat, alphaMode: 'premultiplied', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const device = session.device;
    this.colorPipeline = this.pipeline(COLOR_PASS, 'rgba8unorm', 'VideoBrain color pass');
    this.presentPipeline = this.pipeline(PRESENT_PASS, this.canvasFormat, 'VideoBrain presentation');
    this.sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.parameters = device.createBuffer({ label: 'VideoBrain color parameters', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.effectParameters = device.createBuffer({ label: 'VideoBrain effect parameters', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.emptyTexture = device.createTexture({ label: 'Transparent missing frame', size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.effectLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ] });
  }

  static async create(canvas: HTMLCanvasElement, options: WebGPUDeviceOptions = {}): Promise<WebGPUFrameRuntime> {
    let runtime: WebGPUFrameRuntime | undefined;
    let failure: WebGPUError | undefined;
    const session = await acquireWebGPUDevice({ ...options, onError: (error) => {
      failure = error;
      if (runtime) runtime.failure = error;
      options.onError?.(error);
    } });
    const backend = new WebGPUBackend({ canvas, device: session.device, alpha: true });
    const renderer = new Renderer(backend, { alpha: true, antialias: false, samples: 0, colorBufferType: UnsignedByteType, getFallback: null });
    renderer.library = new StandardNodeLibrary();
    renderer.outputColorSpace = LinearSRGBColorSpace;
    renderer.toneMapping = NoToneMapping;
    renderer.setClearColor(0, 0);
    try {
      await renderer.init();
      if (options.signal?.aborted) throw new WebGPUError('cancelled', 'WebGPU renderer initialization was cancelled.');
      if (session.lost || failure) throw failure ?? new WebGPUError('device-lost', 'WebGPU device was lost during initialization.');
      if (!backend.isWebGPUBackend || renderer.backend !== backend) throw new WebGPUError('initialization', 'Only the explicitly selected WebGPU backend is allowed.');
      runtime = new WebGPUFrameRuntime(canvas, session, renderer, backend);
      return runtime;
    } catch (error) {
      renderer.dispose();
      session.dispose();
      if (error instanceof WebGPUError) throw error;
      throw new WebGPUError('initialization', `WebGPU renderer initialization failed: ${error instanceof Error ? error.message : 'Unknown error.'}`);
    }
  }

  get status() {
    return { backend: 'webgpu' as const, lost: this.session.lost, disposed: this.disposed, allocatedBytes: this.allocatedBytes, frames: this.resources.size, draws: this.draws, error: this.failure?.message ?? null };
  }

  private assertReady() {
    if (this.disposed) throw new WebGPUError('initialization', 'The WebGPU runtime has been disposed.');
    if (this.failure) throw this.failure;
    if (this.session.lost) throw new WebGPUError('device-lost', 'The WebGPU device is lost. Reinitialize the runtime.');
  }

  private checkSize(width: number, height: number, bytesPerPixel: number) {
    this.assertReady();
    if (this.renderingScene) throw new WebGPUError('initialization', 'Wait for the current scene operation before allocating frames.');
    const limit = Math.min(2048, this.session.device.limits.maxTextureDimension2D);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > limit || height > limit || width * height > MAX_FRAME_PIXELS) throw new WebGPUError('limits', 'Frame dimensions exceed the WebGPU graph budget.');
    const bytes = width * height * bytesPerPixel;
    if (this.resources.size >= MAX_FRAME_TARGETS || this.allocatedBytes + bytes > MAX_FRAME_BYTES) throw new WebGPUError('limits', 'WebGPU frame resources exceed the graph budget.');
    return bytes;
  }

  createFrame(width: number, height: number): WebGPUFrame {
    const bytes = this.checkSize(width, height, 4);
    const texture = this.session.device.createTexture({ label: 'VideoBrain graph frame', size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
    const frame: WebGPUFrame = Object.freeze({ width, height, format: 'rgba8unorm', alpha: 'straight' });
    this.resources.set(frame, { texture, bytes });
    this.allocatedBytes += bytes;
    return frame;
  }

  async createSceneFrame(width: number, height: number): Promise<WebGPUFrame> {
    const bytes = this.checkSize(width, height, 8);
    const target = new RenderTarget(width, height, { format: RGBAFormat, type: UnsignedByteType, depthBuffer: true, stencilBuffer: false, samples: 0 });
    target.texture.colorSpace = LinearSRGBColorSpace;
    this.renderingScene = true;
    try {
      this.renderer.setRenderTarget(target);
      await this.renderer.clear(true, true, false);
      this.assertReady();
      const entry: unknown = (this.backend as unknown as { get(value: unknown): unknown }).get(target.texture);
      const texture = typeof entry === 'object' && entry !== null ? Reflect.get(entry, 'texture') as GPUTexture | undefined : undefined;
      if (!texture) throw new WebGPUError('initialization', 'The pinned Three.js backend did not expose the scene texture.');
      const frame: WebGPUFrame = Object.freeze({ width, height, format: 'rgba8unorm', alpha: 'premultiplied' });
      this.resources.set(frame, { texture, bytes, sceneTarget: target });
      this.allocatedBytes += bytes;
      return frame;
    } catch (error) {
      target.dispose();
      throw error;
    } finally {
      this.renderer.setRenderTarget(null);
      this.renderingScene = false;
    }
  }

  private resource(frame: WebGPUFrame) {
    this.assertReady();
    const resource = this.resources.get(frame);
    if (!resource) throw new WebGPUError('initialization', 'Frame is disposed or belongs to another WebGPU device.');
    return resource;
  }

  clear(frame: WebGPUFrame, color: readonly [number, number, number, number]) {
    if (!color.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) throw new WebGPUError('limits', 'Frame clear color must be normalized RGBA.');
    const resource = this.resource(frame);
    if (resource.sceneTarget) throw new WebGPUError('initialization', 'Use renderScene to initialize a scene frame.');
    const encoder = this.session.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: resource.texture.createView(), clearValue: [...color], loadOp: 'clear', storeOp: 'store' }] });
    pass.end();
    this.session.device.queue.submit([encoder.finish()]);
  }

  async renderScene(scene: Scene, camera: Camera, frame: WebGPUFrame) {
    const target = this.resource(frame).sceneTarget;
    if (!target) throw new WebGPUError('initialization', 'Rendering a scene requires a scene frame.');
    if (this.renderingScene) throw new WebGPUError('initialization', 'Concurrent scene submissions are not supported.');
    this.renderingScene = true;
    try {
      this.renderer.setRenderTarget(target);
      await this.renderer.renderAsync(scene, camera);
      this.assertReady();
    } finally {
      this.renderer.setRenderTarget(null);
      this.renderingScene = false;
    }
  }

  process(source: WebGPUFrame, target: WebGPUFrame, values: WebGPUColorParameters = {}) {
    if (source === target) throw new WebGPUError('initialization', 'A frame pass cannot read its own output.');
    const destination = this.resource(target);
    if (destination.sceneTarget) throw new WebGPUError('initialization', 'Frame processors require a straight-alpha graph target.');
    const exposure = values.exposure ?? 0;
    const saturation = values.saturation ?? 1;
    const contrast = values.contrast ?? 1;
    if (!Number.isFinite(exposure) || exposure < -2 || exposure > 2 || !Number.isFinite(saturation) || saturation < 0 || saturation > 3 || !Number.isFinite(contrast) || contrast < 0 || contrast > 3) throw new WebGPUError('limits', 'Color parameters exceed their supported ranges.');
    const origin = this.resource(source);
    const device = this.session.device;
    device.queue.writeBuffer(this.parameters, 0, new Float32Array([exposure, saturation, contrast, source.alpha === 'premultiplied' ? 1 : 0]));
    const bindGroup = device.createBindGroup({ layout: this.colorPipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: origin.texture.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: this.parameters } },
    ] });
    this.draw(this.colorPipeline, bindGroup, destination.texture.createView());
  }

  present(frame: WebGPUFrame) {
    if (frame.alpha !== 'straight') throw new WebGPUError('initialization', 'Convert a scene frame to straight alpha before presentation.');
    const resource = this.resource(frame);
    if (this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.canvas.width = frame.width; this.canvas.height = frame.height;
    }
    const bindGroup = this.session.device.createBindGroup({ layout: this.presentPipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: resource.texture.createView() }, { binding: 1, resource: this.sampler },
    ] });
    this.draw(this.presentPipeline, bindGroup, this.context.getCurrentTexture().createView());
  }

  upload(frame: WebGPUFrame, source: GPUCopyExternalImageSource) {
    const resource = this.resource(frame);
    if (resource.sceneTarget) throw new WebGPUError('initialization', 'Media uploads require a straight-alpha graph target.');
    const width = source instanceof HTMLVideoElement ? source.videoWidth : source instanceof HTMLImageElement ? source.naturalWidth : source instanceof VideoFrame ? source.displayWidth : source.width;
    const height = source instanceof HTMLVideoElement ? source.videoHeight : source instanceof HTMLImageElement ? source.naturalHeight : source instanceof VideoFrame ? source.displayHeight : source.height;
    if (width !== frame.width || height !== frame.height) throw new WebGPUError('limits', 'Media dimensions must match the bounded upload frame.');
    this.session.device.queue.copyExternalImageToTexture({ source, flipY: false }, { texture: resource.texture, premultipliedAlpha: false, colorSpace: 'srgb' }, [frame.width, frame.height]);
  }

  effect(kind: WebGPUFrameEffectKind, source: WebGPUFrame | null, map: WebGPUFrame | null, target: WebGPUFrame, values: GraphParams = {}) {
    if (target === source || target === map) throw new WebGPUError('initialization', 'A frame pass cannot read its own output.');
    if (target.alpha !== 'straight' || source?.alpha === 'premultiplied' || map?.alpha === 'premultiplied') throw new WebGPUError('initialization', 'Frame effects require straight-alpha graph frames.');
    const destination = this.resource(target);
    const origin = source ? this.resource(source).texture : this.emptyTexture;
    const other = map ? this.resource(map).texture : this.emptyTexture;
    const definition = getOperatorDefinition(kind);
    const shader = WEBGPU_FRAME_EFFECTS[kind];
    const parameters = new Float32Array(16);
    parameters.set([target.width, target.height, map ? 1 : 0]);
    shader.params.forEach((id, index) => {
      const param = definition.params[id];
      if (!param) throw new WebGPUError('initialization', `Missing effect parameter: ${kind}.${id}.`);
      const value = values[id] ?? param.defaultValue;
      if (param.type === 'number' && typeof value === 'number' && Number.isFinite(value)) parameters[index + 4] = Math.min(param.max, Math.max(param.min, value));
      else if (param.type === 'select' && typeof value === 'string') {
        const selected = param.options.findIndex((option) => option.value === value);
        if (selected < 0) throw new WebGPUError('limits', `Invalid effect option: ${kind}.${id}.`);
        parameters[index + 4] = selected;
      } else throw new WebGPUError('limits', `Invalid effect parameter: ${kind}.${id}.`);
    });
    let pipeline = this.effectPipelines.get(kind);
    if (!pipeline) { pipeline = this.pipeline(shader.code, 'rgba8unorm', `VideoBrain ${kind}`, deviceLayout(this.session.device, this.effectLayout)); this.effectPipelines.set(kind, pipeline); }
    const device = this.session.device;
    device.queue.writeBuffer(this.effectParameters, 0, parameters);
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: origin.createView() }, { binding: 1, resource: other.createView() },
      { binding: 2, resource: this.sampler }, { binding: 3, resource: { buffer: this.effectParameters } },
    ] });
    this.draw(pipeline, bindGroup, destination.texture.createView());
  }

  async readFrame(frame: WebGPUFrame): Promise<Uint8Array> {
    const texture = this.resource(frame).texture;
    const device = this.session.device;
    const bytesPerRow = Math.ceil(frame.width * 4 / 256) * 256;
    const buffer = device.createBuffer({ label: 'Explicit frame readback', size: bytesPerRow * frame.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [frame.width, frame.height]);
      device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      this.assertReady();
      const mapped = new Uint8Array(buffer.getMappedRange());
      const result = new Uint8Array(frame.width * frame.height * 4);
      for (let row = 0; row < frame.height; row++) result.set(mapped.subarray(row * bytesPerRow, row * bytesPerRow + frame.width * 4), row * frame.width * 4);
      return result;
    } finally { buffer.destroy(); }
  }

  release(frame: WebGPUFrame) {
    const resource = this.resources.get(frame);
    if (!resource) return;
    if (resource.sceneTarget) resource.sceneTarget.dispose(); else resource.texture.destroy();
    this.resources.delete(frame);
    this.allocatedBytes -= resource.bytes;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const frame of this.resources.keys()) this.release(frame);
    this.parameters.destroy();
    this.effectParameters.destroy();
    this.emptyTexture.destroy();
    this.effectPipelines.clear();
    this.renderer.dispose();
    this.context.unconfigure();
    this.session.dispose();
  }

  private pipeline(code: string, format: GPUTextureFormat, label: string, layout: GPUPipelineLayout | 'auto' = 'auto') {
    const module = this.session.device.createShaderModule({ label, code });
    return this.session.device.createRenderPipeline({ label, layout, vertex: { module, entryPoint: 'vertexMain' }, fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
  }

  private draw(pipeline: GPURenderPipeline, bindGroup: GPUBindGroup, view: GPUTextureView) {
    this.assertReady();
    const encoder = this.session.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.draw(3); pass.end();
    this.session.device.queue.submit([encoder.finish()]);
    this.draws++;
  }
}

function deviceLayout(device: GPUDevice, layout: GPUBindGroupLayout) {
  return device.createPipelineLayout({ bindGroupLayouts: [layout] });
}