import {
  MAX_GPU_RENDER_TARGETS,
  MAX_RENDER_DIMENSION,
  MAX_RENDER_PIXEL_RATIO,
  MAX_RENDER_PIXELS,
  MAX_RENDER_RESOURCE_PIXELS,
  compileGraph,
  getOperatorExecution,
  type CompiledGraph,
  type CompiledInputBinding,
  type CompiledNode,
  type GraphDocument,
  type NodeKind,
  type OperatorParamDefinition,
} from '../graph';
import { FRAME_FRAGMENT_SHADERS, FULLSCREEN_VERTEX_SHADER } from './shaders';
import { DataEvaluator, isDataNode, type DataValue } from './DataEvaluator';
import { dataSessions } from './DataSessions';
import { evaluateScene3D, isScene3DNode } from './Scene3DEvaluator';
import { Scene3DRenderer } from './Scene3DRenderer';
import { LiquidSimulation } from './LiquidSimulation';
import { ParticleTransition } from './ParticleTransition';
import { EventEvaluator, isEventNode, type EventValue } from './EventEvaluator';
import { EMPTY_EVENTS } from './eventTiming';
import { signalTests } from './SignalTests';
import { isSignalTest } from '../graph/signalTestOperators';
import type { Scene3DValue, Geometry3DValue, Material3DValue, Camera3DValue, Light3DValue } from '../graph/scene3d';
import { getGradientStops } from '../graph/gradient';
import { buildShaderSource, DEFAULT_SHADER_SOURCE } from '../graph/shaderSource';
import { computeInverseProjectionMap } from './projection';
import {
  evaluateAutoSelector,
  type AutoSelectorOrder,
} from './autoSelector';
import { RollingFrameRate } from './frameTiming';
import { SvgFrameCache, VECTOR_FRAME_READY_EVENT } from './SvgFrameCache';
import { TextFrameCache, TEXT_FRAME_READY_EVENT } from './TextFrameCache';
import {
  createAudioBeatState,
  createAudioOnsetState,
  evaluateAudioBeat,
  evaluateAudioOnset,
  analyzeShapedBands,
  EMPTY_AUDIO_SOURCES,
  SILENT_AUDIO_FRAME,
  type AudioAnalysisFrame,
  type AudioAnalysisSnapshot,
  type AudioBeatState,
  type AudioOnsetState,
} from './audioAnalysis';
import {
  evaluateInternalStrobePhase,
  normalizeStrobePhase,
} from './strobe';

export interface RenderPointer {
  x: number;
  y: number;
  down: number;
  press: number;
  release: number;
}

export interface RendererOptions {
  width?: number;
  height?: number;
  pixelRatio?: number;
  maxPixelRatio?: number;
}

export interface RenderResult {
  rendered: boolean;
  frame: number;
  fps: number;
  passCount: number;
  width: number;
  height: number;
  error: string | null;
}

interface RenderTarget {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

interface NodeResources {
  kind: NodeKind;
  targets: RenderTarget[];
  nextTargetIndex: number;
  lastCommitTime: number | null;
}

interface ProgramInfo {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

interface VideoModelTexture {
  source: VideoSource;
  texture: WebGLTexture;
  dirty: boolean;
}

type VideoSource = HTMLVideoElement | HTMLImageElement;

interface SmoothControlState {
  value: number;
  time: number;
}

interface SourceSelectorState {
  index: number;
  lastTrigger: number;
  lastParam: number;
}

type FrameStateCommit = () => void;

const DEFAULT_POINTER: RenderPointer = Object.freeze({
  x: 0.5,
  y: 0.5,
  down: 0,
  press: 0,
  release: 0,
});
const TWO_PI = Math.PI * 2;

function hasSameRuntimeGraph(
  previous: GraphDocument,
  next: GraphDocument,
): boolean {
  if (
    previous.schemaVersion !== next.schemaVersion ||
    previous.nodes.length !== next.nodes.length ||
    previous.edges.length !== next.edges.length
  ) {
    return false;
  }

  return previous.nodes.every((node, index) => {
    const candidate = next.nodes[index];
    const paramIds = Object.keys(node.params);
    return (
      candidate !== undefined &&
      node.id === candidate.id &&
      node.kind === candidate.kind &&
      paramIds.length === Object.keys(candidate.params).length &&
      paramIds.every((paramId) =>
        Object.hasOwn(candidate.params, paramId) &&
        Object.is(node.params[paramId], candidate.params[paramId]),
      )
    );
  }) && previous.edges.every((edge, index) => {
    const candidate = next.edges[index];
    return (
      candidate !== undefined &&
      edge.id === candidate.id &&
      edge.source.nodeId === candidate.source.nodeId &&
      edge.source.portId === candidate.source.portId &&
      edge.target.nodeId === candidate.target.nodeId &&
      edge.target.portId === candidate.target.portId
    );
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** A bare level keeps every band equal so older callers stay valid. */
function normalizeAudioFrame(
  audio: number | AudioAnalysisFrame,
): AudioAnalysisFrame {
  if (typeof audio === 'number') {
    const level = clamp(finiteOr(audio, 0), 0, 1);
    return { level, bass: level, mid: level, treble: level };
  }
  return {
    level: clamp(finiteOr(audio.level, 0), 0, 1),
    bass: clamp(finiteOr(audio.bass, 0), 0, 1),
    mid: clamp(finiteOr(audio.mid, 0), 0, 1),
    treble: clamp(finiteOr(audio.treble, 0), 0, 1),
  };
}

const MAX_AUDIO_CHAIN_DEPTH = 8;

function normalizeAudioSnapshot(
  audio: number | AudioAnalysisFrame | AudioAnalysisSnapshot,
): AudioAnalysisSnapshot {  if (typeof audio === 'object' && 'frame' in audio) {
    return {
      frame: normalizeAudioFrame(audio.frame),
      sources: audio.sources ?? EMPTY_AUDIO_SOURCES,
    };
  }
  return { frame: normalizeAudioFrame(audio), sources: EMPTY_AUDIO_SOURCES };
}

export interface RenderSize {
  width: number;
  height: number;
}

export function constrainRenderSize(
  width: number,
  height: number,
  pixelRatio = 1,
  maxPixelRatio = MAX_RENDER_PIXEL_RATIO,
  maxDimension = MAX_RENDER_DIMENSION,
  maxPixels = MAX_RENDER_PIXELS,
): RenderSize {
  const safeWidth = Math.max(1, Math.round(finiteOr(width, 1)));
  const safeHeight = Math.max(1, Math.round(finiteOr(height, 1)));
  const safeMaxPixelRatio = clamp(
    finiteOr(maxPixelRatio, MAX_RENDER_PIXEL_RATIO),
    1,
    MAX_RENDER_PIXEL_RATIO,
  );
  const safePixelRatio = clamp(
    finiteOr(pixelRatio, 1),
    0.25,
    safeMaxPixelRatio,
  );
  const safeMaxDimension = Math.max(
    1,
    Math.min(
      MAX_RENDER_DIMENSION,
      Math.floor(finiteOr(maxDimension, MAX_RENDER_DIMENSION)),
    ),
  );
  const safeMaxPixels = Math.max(
    1,
    Math.min(
      MAX_RENDER_PIXELS,
      Math.floor(finiteOr(maxPixels, MAX_RENDER_PIXELS)),
    ),
  );
  const requestedWidth = Math.min(
    Number.MAX_SAFE_INTEGER,
    safeWidth * safePixelRatio,
  );
  const requestedHeight = Math.min(
    Number.MAX_SAFE_INTEGER,
    safeHeight * safePixelRatio,
  );
  const scale = Math.min(
    1,
    safeMaxDimension / requestedWidth,
    safeMaxDimension / requestedHeight,
    Math.sqrt(safeMaxPixels / (requestedWidth * requestedHeight)),
  );

  return {
    width: Math.max(1, Math.floor(requestedWidth * scale)),
    height: Math.max(1, Math.floor(requestedHeight * scale)),
  };
}

function modeIndex(mode: string): number {
  switch (mode) {
    case 'normal':
      return 0;
    case 'screen':
      return 1;
    case 'add':
      return 2;
    case 'multiply':
      return 3;
    default:
      return 1;
  }
}

function videoFitIndex(fit: string): number {
  switch (fit) {
    case 'cover':
      return 0;
    case 'contain':
      return 1;
    case 'stretch':
      return 2;
    default:
      return 0;
  }
}

function transformEdgeModeIndex(mode: string): number {
  switch (mode) {
    case 'transparent':
      return 0;
    case 'clamp':
      return 1;
    case 'repeat':
      return 2;
    case 'mirror':
      return 3;
    default:
      return 0;
  }
}

function channelIndex(channel: string): number {
  switch (channel) {
    case 'luminance':
      return 0;
    case 'red':
      return 1;
    case 'green':
      return 2;
    case 'blue':
      return 3;
    case 'alpha':
      return 4;
    default:
      return 0;
  }
}

function compositeOperationIndex(operation: string): number {
  switch (operation) {
    case 'sourceOver':
      return 0;
    case 'destinationOver':
      return 1;
    case 'sourceIn':
      return 2;
    case 'sourceOut':
      return 3;
    case 'sourceAtop':
      return 4;
    case 'xor':
      return 5;
    default:
      return 0;
  }
}

function strobeClosedModeIndex(mode: string): number {
  switch (mode) {
    case 'black':
      return 0;
    case 'white':
      return 1;
    case 'transparent':
      return 2;
    case 'invert':
      return 3;
    default:
      return 0;
  }
}

interface VideoFrameSource {
  readonly readyState: number;
  readonly videoWidth: number;
  readonly videoHeight: number;
}

export function readVideoFrameSize(
  video: VideoFrameSource,
  maxDimension = MAX_RENDER_DIMENSION,
  maxPixels = MAX_RENDER_PIXELS,
): RenderSize | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (
    video.readyState < 2 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width > maxDimension ||
    height > maxDimension ||
    width * height > maxPixels
  ) {
    return null;
  }
  return { width, height };
}

export function readImageFrameSize(
  image: Pick<HTMLImageElement, 'complete' | 'naturalWidth' | 'naturalHeight'>,
  maxDimension = MAX_RENDER_DIMENSION,
  maxPixels = MAX_RENDER_PIXELS,
): RenderSize | null {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (
    !image.complete ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > maxDimension ||
    height > maxDimension ||
    width * height > maxPixels
  ) {
    return null;
  }
  return { width, height };
}

export class RendererError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RendererError';
  }
}

export class WebGLRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly maxPixelRatio: number;
  private readonly maxTextureDimension: number;
  private plan: CompiledGraph | null = null;
  private programs = new Map<NodeKind, ProgramInfo>();
  private shaderPrograms = new Map<string, { source: string; info: ProgramInfo | null; error: string | null }>();
  private shaderError: RendererError | null = null;
  private nodeResources = new Map<string, NodeResources>();
  private outputTextures = new Map<string, WebGLTexture>();
  private controlValues = new Map<string, number>();
  private dataValues = new Map<string, DataValue>();
  private dataEvaluator = new DataEvaluator();
  private sceneValues = new Map<string, Scene3DValue>();
  private eventValues = new Map<string, EventValue>();
  private eventEvaluator = new EventEvaluator();
  private sceneRenderer: Scene3DRenderer | null = null;
  private liquidSimulations = new Map<string, LiquidSimulation>();
  private particleTransition: ParticleTransition | null = null;
  private smoothControlStates = new Map<string, SmoothControlState>();
  private audioOnsetStates = new Map<string, AudioOnsetState>();
  private audioBeatStates = new Map<string, AudioBeatState>();
  private sourceSelectorStates = new Map<string, SourceSelectorState>();
  private vertexArray: WebGLVertexArrayObject | null = null;
  private blackTexture: WebGLTexture | null = null;
  private transparentTexture: WebGLTexture | null = null;
  private videoTexture: WebGLTexture | null = null;
  private videoSource: VideoSource | null = null;
  private videoSourceWidth = 1;
  private videoSourceHeight = 1;
  private videoModelSources = new Map<string, VideoSource>();
  private videoModelTextures = new Map<string, VideoModelTexture>();
  private renderWidth = 1;
  private renderHeight = 1;
  private frameCount = 0;
  private readonly frameRate = new RollingFrameRate();
  private lastPassCount = 0;
  private errorState: Error | null = null;
  private contextLost = false;
  private disposed = false;
  private readonly vectorFrames = new SvgFrameCache(() => {
    this.canvas.dispatchEvent(new Event(VECTOR_FRAME_READY_EVENT));
  });
  private readonly textValues = new Map<string, string>();
  private readonly textFrames = new TextFrameCache(() => {
    this.canvas.dispatchEvent(new Event(TEXT_FRAME_READY_EVENT));
  });

  constructor(canvas: HTMLCanvasElement, options: RendererOptions = {}) {
    this.canvas = canvas;
    this.maxPixelRatio = clamp(
      finiteOr(options.maxPixelRatio ?? 1.5, 1.5),
      1,
      MAX_RENDER_PIXEL_RATIO,
    );
    const context = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!context) {
      throw new RendererError('WebGL2 is not available in this browser.');
    }
    this.gl = context;
    const reportedMaxTextureSize = context.getParameter(
      context.MAX_TEXTURE_SIZE,
    ) as unknown;
    this.maxTextureDimension = Math.max(
      1,
      Math.min(
        MAX_RENDER_DIMENSION,
        typeof reportedMaxTextureSize === 'number' &&
          Number.isFinite(reportedMaxTextureSize)
          ? Math.floor(reportedMaxTextureSize)
          : MAX_RENDER_DIMENSION,
      ),
    );
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.addEventListener(
      'webglcontextrestored',
      this.handleContextRestored,
    );
    this.initializeContextResources();

    const width = options.width ?? (canvas.clientWidth || canvas.width || 960);
    const height = options.height ?? (canvas.clientHeight || canvas.height || 540);
    const browserPixelRatio =
      typeof window === 'undefined' ? 1 : window.devicePixelRatio;
    this.resize(width, height, options.pixelRatio ?? browserPixelRatio);
  }

  get width(): number {
    return this.renderWidth;
  }

  get height(): number {
    return this.renderHeight;
  }

  get lastError(): Error | null {
    return this.errorState;
  }

  get isContextLost(): boolean {
    return this.contextLost;
  }

  setGraph(document: GraphDocument): void {
    try {
      this.assertActive();
      if (
        this.plan &&
        !this.errorState &&
        hasSameRuntimeGraph(this.plan.document, document)
      ) {
        return;
      }
      this.applyCompiledGraph(compileGraph(document));
    } catch (error) {
      this.errorState = this.asError(error);
      throw this.errorState;
    }
  }

  setVideoSource(video: VideoSource | null): void {
    this.assertActive();
    if (this.videoSource === video) {
      return;
    }
    this.videoSource = video;
    this.videoSourceWidth = 1;
    this.videoSourceHeight = 1;
    if (!this.contextLost) {
      this.resetVideoTexture();
    }
  }

  setVideoModelSources(
    sources: ReadonlyMap<string, VideoSource>,
  ): void {
    this.assertActive();
    if (this.plan) {
      this.assertResourceBudget(
        this.plan,
        this.renderWidth,
        this.renderHeight,
        sources,
      );
    }
    const previousSources = this.videoModelSources;
    this.videoModelSources = new Map(sources);
    if (!this.contextLost) {
      try {
        this.reconcileVideoModelTextures();
      } catch (error) {
        this.videoModelSources = previousSources;
        throw error;
      }
    }
  }

  setCompiledGraph(graph: CompiledGraph): void {
    this.assertActive();
    this.applyCompiledGraph(compileGraph(graph.document));
  }

  private applyCompiledGraph(validatedGraph: CompiledGraph): void {
    this.assertResourceBudget(validatedGraph);
    const previousPlan = this.plan;
    this.plan = validatedGraph;
    if (!this.contextLost) {
      this.errorState = null;
      try {
        this.reconcileNodeResources();
        this.reconcileVideoModelTextures();
      } catch (error) {
        const applyError = this.asError(error);
        this.releaseNodeResources();
        this.releaseVideoModelTextures();
        this.plan = previousPlan;
        try {
          if (previousPlan) {
            this.reconcileNodeResources();
            this.reconcileVideoModelTextures();
          }
        } catch (rollbackError) {
          this.errorState = new RendererError(
            `The new graph failed and the previous GPU plan could not be restored: ${this.asError(rollbackError).message}`,
          );
          throw this.errorState;
        }
        this.errorState = applyError;
        throw applyError;
      }
    }
    const smoothNodeIds = new Set(
      validatedGraph.document.nodes
        .filter(({ kind }) => kind === 'smooth')
        .map(({ id }) => id),
    );
    for (const nodeId of this.smoothControlStates.keys()) {
      if (!smoothNodeIds.has(nodeId)) {
        this.smoothControlStates.delete(nodeId);
      }
    }
    this.pruneNodeStates(this.audioOnsetStates, validatedGraph, 'audioTrigger');
    this.pruneNodeStates(this.audioBeatStates, validatedGraph, 'audioBeat');
    const liquidIds = new Set(validatedGraph.frameNodes.filter(({ node }) => node.kind === 'liquidMetaballs').map(({ node }) => node.id));
    for (const [id, simulation] of this.liquidSimulations) if (!liquidIds.has(id)) { simulation.reset(); this.liquidSimulations.delete(id); }
    if (!validatedGraph.frameNodes.some(({ node }) => node.kind === 'particleTransition')) { this.particleTransition?.dispose(); this.particleTransition = null; }
    this.pruneNodeStates(
      this.sourceSelectorStates,
      validatedGraph,
      'sourceSelector',
    );
  }

  private pruneNodeStates(
    states: Map<string, unknown>,
    graph: CompiledGraph,
    kind: NodeKind,
  ): void {
    const nodeIds = new Set(
      graph.document.nodes
        .filter((node) => node.kind === kind)
        .map(({ id }) => id),
    );
    for (const nodeId of states.keys()) {
      if (!nodeIds.has(nodeId)) {
        states.delete(nodeId);
      }
    }
    dataSessions.reconcile(this.plan);
    this.dataEvaluator.clear();
    this.eventEvaluator.retain(new Set((this.plan?.controlNodes ?? []).filter(({ node }) => isEventNode(node.kind)).map(({ node }) => node.id)));
    signalTests.retain(new Set((this.plan?.controlNodes ?? []).filter(({ node }) => isSignalTest(node.kind)).map(({ node }) => node.id)));
  }

  resize(width: number, height: number, pixelRatio = 1): void {
    this.assertActive();
    const physicalSize = constrainRenderSize(
      width,
      height,
      pixelRatio,
      this.maxPixelRatio,
      this.maxTextureDimension,
    );
    const physicalWidth = physicalSize.width;
    const physicalHeight = physicalSize.height;
    if (this.plan) {
      this.assertResourceBudget(
        this.plan,
        physicalWidth,
        physicalHeight,
        this.videoModelSources,
      );
    }
    if (
      physicalWidth === this.renderWidth &&
      physicalHeight === this.renderHeight &&
      this.canvas.width === physicalWidth &&
      this.canvas.height === physicalHeight
    ) {
      return;
    }

    const previousWidth = this.renderWidth;
    const previousHeight = this.renderHeight;
    const previousCanvasWidth = this.canvas.width;
    const previousCanvasHeight = this.canvas.height;
    try {
      this.renderWidth = physicalWidth;
      this.renderHeight = physicalHeight;
      this.canvas.width = physicalWidth;
      this.canvas.height = physicalHeight;
      if (!this.contextLost) {
        this.reconcileNodeResources();
        this.errorState = null;
      }
    } catch (error) {
      this.renderWidth = previousWidth;
      this.renderHeight = previousHeight;
      this.canvas.width = previousCanvasWidth;
      this.canvas.height = previousCanvasHeight;
      this.errorState = this.asError(error);
      throw this.errorState;
    }
  }

  render(
    timeSeconds: number,
    audioLevel: number | AudioAnalysisFrame | AudioAnalysisSnapshot = 0,
    pointer: RenderPointer = DEFAULT_POINTER,
    presentationTimestamp?: number,
  ): RenderResult {
    if (this.disposed) {
      return this.result(false, new RendererError('Renderer has been disposed.'));
    }
    if (this.contextLost) {
      return this.result(false, this.errorState);
    }

    try {
      const time = finiteOr(timeSeconds, 0);
      const audio = normalizeAudioSnapshot(audioLevel);
      const safePointer = {
        x: clamp(finiteOr(pointer.x, 0.5), 0, 1),
        y: clamp(finiteOr(pointer.y, 0.5), 0, 1),
        down: clamp(finiteOr(pointer.down, 0), 0, 1),
        press: clamp(finiteOr(pointer.press, 0), 0, 1),
        release: clamp(finiteOr(pointer.release, 0), 0, 1),
      };

      this.controlValues.clear();
      this.textValues.clear();
      this.dataValues.clear();
      this.sceneValues.clear();
      this.eventValues.clear();
      this.outputTextures.clear();
      for (const node of this.plan?.controlNodes ?? []) {
        this.evaluateControlNode(node, time, audio, safePointer);
      }
      if (!this.plan || this.plan.displayNodes.length === 0) {
        this.clearDisplay();
        this.lastPassCount = 0;
        this.errorState = null;
        this.frameCount += 1;
        if (presentationTimestamp !== undefined) {
          this.frameRate.sample(presentationTimestamp);
        }
        return this.result(true, null);
      }

      if (this.plan.frameNodes.some(({ node }) => node.kind === 'videoInput' || node.kind === 'file')) {
        this.uploadVideoFrame();
      }
      const frameStateCommits: FrameStateCommit[] = [];
      this.shaderError = null;
      for (const node of this.plan.frameNodes) {
        const commit = this.renderFrameNode(node, time);
        if (commit) {
          frameStateCommits.push(commit);
        }
      }
      const displayNode =
        this.plan.displayNodes.find((node) => node.inputs.source !== undefined) ??
        this.plan.displayNodes[0];
      this.renderDisplayNode(displayNode);
      for (const commit of frameStateCommits) {
        commit();
      }
      this.lastPassCount = this.plan.visualPasses;
      this.errorState = null;
      this.frameCount += 1;
      if (presentationTimestamp !== undefined) {
        this.frameRate.sample(presentationTimestamp);
      }
      return this.result(true, this.shaderError);
    } catch (error) {
      this.errorState = this.asError(error);
      return this.result(false, this.errorState);
    }
  }

  clearError(): void {
    this.errorState = null;
  }

  resetFrameRate(): void {
    this.frameRate.reset();
  }

  reset(): void {
    for (const simulation of this.liquidSimulations.values()) simulation.reset();
    signalTests.reset();
    this.eventEvaluator.clear();
    this.eventValues.clear();
    this.assertActive();
    this.vectorFrames.markDirty();
    this.textFrames.markDirty();
    this.frameCount = 0;
    this.frameRate.reset();
    this.lastPassCount = 0;
    this.controlValues.clear();
    this.smoothControlStates.clear();
    this.audioOnsetStates.clear();
    this.audioBeatStates.clear();
    this.sourceSelectorStates.clear();
    this.outputTextures.clear();
    for (const resources of this.nodeResources.values()) {
      resources.nextTargetIndex = 0;
      resources.lastCommitTime = null;
      for (const target of resources.targets) {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target.framebuffer);
        this.gl.viewport(0, 0, target.width, target.height);
        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      }
    }
    if (!this.contextLost) {
      this.resetVideoTexture();
      this.clearDisplay();
    }
  }

  dispose(): void {
    for (const simulation of this.liquidSimulations.values()) simulation.reset();
    this.liquidSimulations.clear();
    this.particleTransition?.dispose(); this.particleTransition = null;
    signalTests.reset();
    this.eventEvaluator.clear();
    this.eventValues.clear();
    this.sceneRenderer?.dispose();
    this.sceneRenderer = null;
    this.sceneValues.clear();
    dataSessions.dispose();
    this.dataEvaluator.clear();
    this.dataValues.clear();
    if (this.disposed) {
      return;
    }
    this.vectorFrames.clear();
    this.textFrames.clear();
    this.textValues.clear();
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener(
      'webglcontextrestored',
      this.handleContextRestored,
    );
    if (!this.contextLost) {
      this.releaseNodeResources();
      this.releaseVideoModelTextures();
      for (const info of this.programs.values()) {
        this.gl.deleteProgram(info.program);
      }
      for (const entry of this.shaderPrograms.values()) {
        if (entry.info) this.gl.deleteProgram(entry.info.program);
      }
      if (this.blackTexture) {
        this.gl.deleteTexture(this.blackTexture);
      }
      if (this.transparentTexture) {
        this.gl.deleteTexture(this.transparentTexture);
      }
      if (this.videoTexture) {
        this.gl.deleteTexture(this.videoTexture);
      }
      if (this.vertexArray) {
        this.gl.deleteVertexArray(this.vertexArray);
      }
    }
    this.programs.clear();
    this.outputTextures.clear();
    this.shaderPrograms.clear();
    this.controlValues.clear();
    this.smoothControlStates.clear();
    this.audioOnsetStates.clear();
    this.audioBeatStates.clear();
    this.sourceSelectorStates.clear();
    this.blackTexture = null;
    this.transparentTexture = null;
    this.videoTexture = null;
    this.videoSource = null;
    this.videoSourceWidth = 1;
    this.videoSourceHeight = 1;
    this.videoModelSources.clear();
    this.videoModelTextures.clear();
    this.vertexArray = null;
    this.plan = null;
    this.disposed = true;
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.disposed) {
      return;
    }
    this.contextLost = true;
    for (const simulation of this.liquidSimulations.values()) simulation.reset();
    this.liquidSimulations.clear();
    this.particleTransition?.dispose(); this.particleTransition = null;
    signalTests.reset();
    this.eventEvaluator.clear();
    this.eventValues.clear();
    this.sceneRenderer?.dispose();
    this.sceneRenderer = null;
    this.sceneValues.clear();
    this.vectorFrames.clear();
    this.textFrames.clear();
    this.textValues.clear();
    this.errorState = new RendererError('The graphics context was lost.');
    this.nodeResources.clear();
    this.outputTextures.clear();
    this.controlValues.clear();
    this.smoothControlStates.clear();
    this.audioOnsetStates.clear();
    this.audioBeatStates.clear();
    this.sourceSelectorStates.clear();
    this.programs.clear();
    this.shaderPrograms.clear();
    this.blackTexture = null;
    this.transparentTexture = null;
    this.videoTexture = null;
    this.videoModelTextures.clear();
    this.videoSourceWidth = 1;
    this.videoSourceHeight = 1;
    this.vertexArray = null;
  };

  private readonly handleContextRestored = (): void => {
    if (this.disposed) {
      return;
    }
    this.contextLost = false;
    try {
      this.initializeContextResources();
      this.reconcileNodeResources();
      this.reconcileVideoModelTextures();
      this.errorState = null;
    } catch (error) {
      this.errorState = this.asError(error);
    }
  };

  private initializeContextResources(): void {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    const vertexArray = gl.createVertexArray();
    const blackTexture = gl.createTexture();
    const transparentTexture = gl.createTexture();
    const videoTexture = gl.createTexture();
    if (!vertexArray || !blackTexture || !transparentTexture || !videoTexture) {
      if (vertexArray) {
        gl.deleteVertexArray(vertexArray);
      }
      if (blackTexture) {
        gl.deleteTexture(blackTexture);
      }
      if (transparentTexture) {
        gl.deleteTexture(transparentTexture);
      }
      if (videoTexture) {
        gl.deleteTexture(videoTexture);
      }
      throw new RendererError('Unable to allocate graphics resources.');
    }
    this.vertexArray = vertexArray;
    this.blackTexture = blackTexture;
    this.transparentTexture = transparentTexture;
    this.videoTexture = videoTexture;
    this.initializeSinglePixelTexture(blackTexture, [0, 0, 0, 255]);
    this.initializeSinglePixelTexture(transparentTexture, [0, 0, 0, 0]);
    this.resetVideoTexture();
  }

  private initializeSinglePixelTexture(
    texture: WebGLTexture,
    rgba: readonly [number, number, number, number],
  ): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(rgba),
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private resetVideoTexture(): void {
    const texture = this.videoTexture;
    if (!texture) {
      return;
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]),
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.videoSourceWidth = 1;
    this.videoSourceHeight = 1;
  }

  private uploadVideoFrame(): void {
    const video = this.videoSource;
    const texture = this.videoTexture;
    if (!video || !texture) {
      return;
    }
    const size =
      video instanceof HTMLImageElement
        ? readImageFrameSize(video, this.maxTextureDimension, MAX_RENDER_PIXELS)
        : readVideoFrameSize(video, this.maxTextureDimension, MAX_RENDER_PIXELS);
    if (!size) {
      return;
    }
    if (this.plan) {
      this.assertResourceBudget(
        this.plan,
        this.renderWidth,
        this.renderHeight,
        this.videoModelSources,
        size,
      );
    }

    const gl = this.gl;
    try {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        video,
      );
      this.videoSourceWidth = size.width;
      this.videoSourceHeight = size.height;
    } catch {
      // Media readiness can change between inspection and upload. Keep the
      // previous valid frame and retry on the next render.
    } finally {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }

  private reconcileVideoModelTextures(): void {
    if (this.contextLost) {
      return;
    }
    const activeNodeIds = new Set(
      this.plan?.frameNodes
        .filter(({ node }) => node.kind === 'videoModel' || node.kind === 'networkVideo')
        .map(({ node }) => node.id) ?? [],
    );

    const previous = this.videoModelTextures;
    const next = new Map<string, VideoModelTexture>();
    const created: VideoModelTexture[] = [];
    const sourceUpdates: Array<{
      entry: VideoModelTexture;
      source: VideoSource;
    }> = [];
    try {
      for (const nodeId of activeNodeIds) {
        const source = this.videoModelSources.get(nodeId);
        if (!source) {
          continue;
        }
        const existing = previous.get(nodeId);
        if (existing) {
          next.set(nodeId, existing);
          if (existing.source !== source) {
            sourceUpdates.push({ entry: existing, source });
          }
          continue;
        }
        const entry: VideoModelTexture = {
          source,
          texture: this.createSourceTexture(),
          dirty: true,
        };
        created.push(entry);
        next.set(nodeId, entry);
      }
    } catch (error) {
      for (const entry of created) {
        this.gl.deleteTexture(entry.texture);
      }
      throw error;
    }
    for (const { entry, source } of sourceUpdates) {
      entry.source = source;
      entry.dirty = true;
    }
    for (const [nodeId, entry] of previous) {
      if (next.get(nodeId) !== entry) {
        this.gl.deleteTexture(entry.texture);
      }
    }
    this.videoModelTextures = next;
  }

  private createSourceTexture(): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) {
      throw new RendererError('Unable to allocate a model frame texture.');
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]),
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }

  private uploadVideoModelFrame(nodeId: string): WebGLTexture | null {
    const entry = this.videoModelTextures.get(nodeId);
    if (!entry) {
      return null;
    }
    if (!entry.dirty && entry.source instanceof HTMLImageElement) {
      return entry.texture;
    }
    const size = entry.source instanceof HTMLImageElement
      ? readImageFrameSize(entry.source, this.maxTextureDimension, MAX_RENDER_PIXELS)
      : readVideoFrameSize(entry.source, this.maxTextureDimension, MAX_RENDER_PIXELS);
    if (!size) {
      return null;
    }
    if (this.plan) this.assertResourceBudget(this.plan);
    const gl = this.gl;
    try {
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        entry.source,
      );
      entry.dirty = false;
      return entry.texture;
    } finally {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }

  private releaseVideoModelTextures(): void {
    for (const entry of this.videoModelTextures.values()) {
      this.gl.deleteTexture(entry.texture);
    }
    this.videoModelTextures.clear();
  }

  private assertResourceBudget(
    graph: CompiledGraph,
    width = this.renderWidth,
    height = this.renderHeight,
    modelSources: ReadonlyMap<string, VideoSource> = this.videoModelSources,
    videoSize: RenderSize = {
      width: this.videoSourceWidth,
      height: this.videoSourceHeight,
    },
  ): void {
    const targetCount = graph.frameNodes.reduce(
      (count, { node }) =>
        count + getOperatorExecution(node.kind).renderTargets,
      0,
    );
    if (targetCount > MAX_GPU_RENDER_TARGETS) {
      throw new RendererError(
        `Graph requires ${targetCount} offscreen frames; the limit is ${MAX_GPU_RENDER_TARGETS}.`,
      );
    }
    const activeModelIds = new Set(
      graph.frameNodes
        .filter(({ node }) => node.kind === 'videoModel' || node.kind === 'networkVideo')
        .map(({ node }) => node.id),
    );
    let sourcePixels = graph.frameNodes.some(
      ({ node }) => node.kind === 'videoInput' || node.kind === 'file',
    )
      ? videoSize.width * videoSize.height
      : 0;
    for (const [nodeId, image] of modelSources) {
      if (!activeModelIds.has(nodeId)) {
        continue;
      }
      const size = image instanceof HTMLImageElement
        ? readImageFrameSize(image, this.maxTextureDimension, MAX_RENDER_PIXELS)
        : readVideoFrameSize(image, this.maxTextureDimension, MAX_RENDER_PIXELS);
      if (size) {
        sourcePixels += size.width * size.height;
      }
    }
    if (width * height * targetCount + sourcePixels > MAX_RENDER_RESOURCE_PIXELS) {
      throw new RendererError('The graph exceeds the graphics resource budget.');
    }
  }

  private reconcileNodeResources(): void {
    const render3dIds = new Set(this.plan?.frameNodes.filter(({ node }) => node.kind === 'render3d').map(({ node }) => node.id));
    this.sceneRenderer?.retain(render3dIds);
    if (render3dIds.size === 0 && this.sceneRenderer) { this.sceneRenderer.dispose(); this.sceneRenderer = null; }
    const activeShaders = new Set(this.plan?.frameNodes.filter(({ node }) => node.kind === 'shaderSource').map(({ node }) => node.id));
    for (const [nodeId, entry] of this.shaderPrograms) {
      if (!activeShaders.has(nodeId)) {
        if (entry.info) this.gl.deleteProgram(entry.info.program);
        this.shaderPrograms.delete(nodeId);
      }
    }
    if (this.contextLost || !this.plan) {
      return;
    }
    const previous = this.nodeResources;
    const next = new Map<string, NodeResources>();
    const created: NodeResources[] = [];
    try {
      for (const compiledNode of this.plan.frameNodes) {
        const node = compiledNode.node;
        const targetCount = node.kind === 'render3d' ? 2 : getOperatorExecution(node.kind).renderTargets;
        const existing = previous.get(node.id);
        const canReuse =
          existing?.kind === node.kind &&
          existing.targets.length === targetCount &&
          existing.targets.every(
            (target) =>
              target.width === this.renderWidth &&
              target.height === this.renderHeight,
          );
        if (existing && canReuse) {
          next.set(node.id, existing);
          continue;
        }
        const resources: NodeResources = {
          kind: node.kind,
          targets: [],
          nextTargetIndex: 0,
          lastCommitTime: null,
        };
        created.push(resources);
        for (let index = 0; index < targetCount; index += 1) {
          resources.targets.push(this.createRenderTarget());
        }
        next.set(node.id, resources);
      }
    } catch (error) {
      for (const resources of created) {
        this.releaseResources(resources);
      }
      throw error;
    }
    for (const [nodeId, resources] of previous) {
      if (next.get(nodeId) !== resources) {
        this.releaseResources(resources);
      }
    }
    this.nodeResources = next;
    this.vectorFrames.retain(new Set(
      this.plan.frameNodes.filter(({ node }) => node.kind === 'vectorShape').map(({ node }) => node.id),
    ));
    this.textFrames.retain(new Set(
      this.plan.frameNodes.filter(({ node }) => node.kind === 'text').map(({ node }) => node.id),
    ));
  }

  private createRenderTarget(): RenderTarget {
    const gl = this.gl;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) {
      if (texture) {
        gl.deleteTexture(texture);
      }
      if (framebuffer) {
        gl.deleteFramebuffer(framebuffer);
      }
      throw new RendererError('Unable to allocate an offscreen frame.');
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(
      gl.TEXTURE_2D,
      1,
      gl.RGBA8,
      this.renderWidth,
      this.renderHeight,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      throw new RendererError('An offscreen frame is incomplete.');
    }
    gl.viewport(0, 0, this.renderWidth, this.renderHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return {
      texture,
      framebuffer,
      width: this.renderWidth,
      height: this.renderHeight,
    };
  }

  private releaseNodeResources(): void {
    for (const resources of this.nodeResources.values()) {
      this.releaseResources(resources);
    }
    this.nodeResources.clear();
    this.outputTextures.clear();
  }

  private releaseResources(resources: NodeResources): void {
    for (const target of resources.targets) {
      this.gl.deleteFramebuffer(target.framebuffer);
      this.gl.deleteTexture(target.texture);
    }
    resources.targets.length = 0;
  }

  private evaluateControlNode(
    compiledNode: CompiledNode,
    time: number,
    audio: AudioAnalysisSnapshot,
    pointer: RenderPointer,
  ): void {
    const node = compiledNode.node;
    if (isSignalTest(node.kind)) {
      const binding = compiledNode.inputs.value;
      const key = binding ? this.controlKey(binding.sourceNodeId, binding.sourcePortId) : '';
      const output = this.controlKey(node.id, 'value');
      signalTests.prepare(node.id, time, JSON.stringify(binding ?? null));
      if (node.kind === 'signalNumber') {
        const value = this.controlValues.get(key) ?? 0;
        signalTests.number(node.id, value, Boolean(binding));
        this.setControl(node.id, 'value', value);
      } else if (node.kind === 'signalText') {
        const value = this.textValues.get(key) ?? '';
        signalTests.text(node.id, value, Boolean(binding));
        this.textValues.set(output, value);
      } else if (node.kind === 'signalEdge') {
        const value = this.eventValues.get(key) === true;
        signalTests.edge(node.id, value, Boolean(binding), time, this.numberParam(compiledNode, 'flash'));
        this.eventValues.set(output, value);
      } else {
        const value = this.eventValues.get(key);
        const events = Array.isArray(value) ? value : EMPTY_EVENTS;
        this.eventValues.set(output, signalTests.bang(node.id, events, Boolean(binding), time, this.numberParam(compiledNode, 'flash')));
      }
      return;
    }
    if (isEventNode(node.kind)) {
      const inputs: Record<string, EventValue> = {};
      for (const [id, binding] of Object.entries(compiledNode.inputs)) {
        const key = this.controlKey(binding.sourceNodeId, binding.sourcePortId);
        inputs[id] = binding.type === 'control.f32' ? this.controlValues.get(key) ?? 0
          : this.eventValues.get(key) ?? (binding.type === 'control.bool' ? false : EMPTY_EVENTS);
      }
      const outputs = this.eventEvaluator.evaluate(compiledNode, inputs, Math.max(0, time));
      for (const [id, value] of Object.entries(outputs)) {
        if (typeof value === 'number') this.setControl(node.id, id, value);
        else this.eventValues.set(this.controlKey(node.id, id), value);
      }
      return;
    }
    if (isScene3DNode(node.kind)) {
      const inputs: Record<string, Scene3DValue | number> = {};
      for (const [id, binding] of Object.entries(compiledNode.inputs)) {
        const key = this.controlKey(binding.sourceNodeId, binding.sourcePortId);
        inputs[id] = binding.type === 'control.f32' ? this.controlValues.get(key) ?? 0 : this.sceneValues.get(key) ?? null;
      }
      const values = evaluateScene3D(compiledNode, inputs);
      for (const [id, value] of Object.entries(values)) {
        if (typeof value === 'number') this.setControl(node.id, id, value);
        else this.sceneValues.set(this.controlKey(node.id, id), value);
      }
      return;
    }
    if (isDataNode(node.kind)) {
      const inputs: Record<string, DataValue> = {};
      for (const [id, binding] of Object.entries(compiledNode.inputs)) {
        const key = this.controlKey(binding.sourceNodeId, binding.sourcePortId);
        inputs[id] = binding.type === 'text.utf8' ? this.textValues.get(key) ?? ''
          : binding.type === 'control.f32' ? this.controlValues.get(key) ?? 0 : this.dataValues.get(key) ?? null;
      }
      const outputs = this.dataEvaluator.evaluate(compiledNode, inputs);
      for (const port of compiledNode.definition.outputs) {
        const key = this.controlKey(node.id, port.id);
        const value = outputs[port.id];
        if (port.type === 'text.utf8') this.textValues.set(key, typeof value === 'string' ? value : '');
        else if (port.type === 'control.f32') this.setControl(node.id, port.id, typeof value === 'number' ? value : 0);
        else this.dataValues.set(key, value ?? null);
      }
      return;
    }
    switch (node.kind) {
      case 'aiPrompt':
        this.textValues.set(this.controlKey(node.id, 'prompt'), this.textParam(compiledNode, 'text'));
        return;
      case 'time': {
        const speed = this.numberParam(compiledNode, 'speed');
        const offset = this.numberParam(compiledNode, 'offset');
        this.setControl(node.id, 'value', time * speed + offset);
        return;
      }
      case 'beatClock': {
        const sourceTime = this.controlInput(compiledNode, 'time', time);
        const beatsPerSecond = this.numberParam(compiledNode, 'bpm') / 60;
        const beatsPerBar = Math.max(
          1,
          Math.round(this.numberParam(compiledNode, 'beatsPerBar')),
        );
        const beatPosition =
          sourceTime * beatsPerSecond +
          this.numberParam(compiledNode, 'offset');
        const phase = beatPosition - Math.floor(beatPosition);
        const barPosition = beatPosition / beatsPerBar;
        this.setControl(node.id, 'phase', phase);
        this.setControl(
          node.id,
          'beat',
          phase < this.numberParam(compiledNode, 'pulseWidth') ? 1 : 0,
        );
        this.setControl(
          node.id,
          'bar',
          barPosition - Math.floor(barPosition),
        );
        return;
      }
      case 'autoSelector': {
        const position = this.controlInput(compiledNode, 'position', time);
        const sample = evaluateAutoSelector(
          position,
          clamp(this.numberParam(compiledNode, 'interval'), 0.1, 60),
          Math.round(
            clamp(this.numberParam(compiledNode, 'count'), 2, 4),
          ),
          this.stringParam(compiledNode, 'order') as AutoSelectorOrder,
          Math.round(
            clamp(this.numberParam(compiledNode, 'seed'), 0, 65_535),
          ),
        );
        this.setControl(node.id, 'index', sample.index);
        this.setControl(node.id, 'phase', sample.phase);
        return;
      }
      case 'oscillator': {
        const phaseSignal = this.controlInput(compiledNode, 'phase', time);
        const frequency = this.numberParam(compiledNode, 'frequency');
        const phase = this.numberParam(compiledNode, 'phase');
        const amplitude = this.numberParam(compiledNode, 'amplitude');
        const offset = this.numberParam(compiledNode, 'offset');
        const cycle = phaseSignal * frequency + phase;
        const fraction = cycle - Math.floor(cycle);
        const waveform = this.stringParam(compiledNode, 'waveform');
        let value: number;
        switch (waveform) {
          case 'triangle':
            value = 1 - Math.abs(fraction * 2 - 1);
            break;
          case 'saw':
            value = fraction;
            break;
          case 'square':
            value = fraction < 0.5 ? 1 : 0;
            break;
          default:
            value = Math.sin(cycle * TWO_PI) * 0.5 + 0.5;
        }
        this.setControl(node.id, 'value', offset + value * amplitude);
        return;
      }
      case 'constant':
        this.setControl(
          node.id,
          'value',
          this.numberParam(compiledNode, 'value'),
        );
        return;
      case 'math': {
        const a = this.controlInput(
          compiledNode,
          'a',
          this.numberParam(compiledNode, 'a'),
        );
        const b = this.controlInput(
          compiledNode,
          'b',
          this.numberParam(compiledNode, 'b'),
        );
        let value: number;
        switch (this.stringParam(compiledNode, 'operation')) {
          case 'subtract':
            value = a - b;
            break;
          case 'multiply':
            value = a * b;
            break;
          case 'divide':
            value = b === 0 ? 0 : a / b;
            break;
          case 'min':
            value = Math.min(a, b);
            break;
          case 'max':
            value = Math.max(a, b);
            break;
          default:
            value = a + b;
        }
        this.setControl(node.id, 'value', value);
        return;
      }
      case 'mapRange': {
        const input = this.controlInput(compiledNode, 'value', 0);
        const inputMin = this.numberParam(compiledNode, 'inMin');
        const inputMax = this.numberParam(compiledNode, 'inMax');
        const outputMin = this.numberParam(compiledNode, 'outMin');
        const outputMax = this.numberParam(compiledNode, 'outMax');
        const inputSpan = inputMax - inputMin;
        let position = inputSpan === 0 ? 0 : (input - inputMin) / inputSpan;
        position = finiteOr(position, 0);
        switch (this.stringParam(compiledNode, 'boundary')) {
          case 'clamp':
            position = clamp(position, 0, 1);
            break;
          case 'wrap':
            position = ((position % 1) + 1) % 1;
            break;
          case 'fold': {
            const folded = ((position % 2) + 2) % 2;
            position = folded <= 1 ? folded : 2 - folded;
            break;
          }
          default:
            break;
        }
        this.setControl(
          node.id,
          'value',
          finiteOr(outputMin + (outputMax - outputMin) * position, outputMin),
        );
        return;
      }
      case 'smooth': {
        const initial = this.numberParam(compiledNode, 'initial');
        const input = this.controlInput(compiledNode, 'value', initial);
        const previous = this.smoothControlStates.get(node.id);
        if (!previous || time < previous.time) {
          this.smoothControlStates.set(node.id, { value: initial, time });
          this.setControl(node.id, 'value', initial);
          return;
        }
        const duration = this.numberParam(
          compiledNode,
          input >= previous.value ? 'rise' : 'fall',
        );
        const elapsed = Math.max(0, time - previous.time);
        const blend = duration === 0 ? 1 : 1 - Math.exp(-elapsed / duration);
        const value = finiteOr(
          previous.value + (input - previous.value) * blend,
          input,
        );
        this.smoothControlStates.set(node.id, { value, time });
        this.setControl(node.id, 'value', value);
        return;
      }
      case 'pointer':
        this.setControl(node.id, 'x', pointer.x);
        this.setControl(node.id, 'y', pointer.y);
        this.setControl(node.id, 'down', pointer.down);
        this.setControl(node.id, 'press', pointer.press);
        this.setControl(node.id, 'release', pointer.release);
        return;
      case 'xyPad':
        this.setControl(node.id, 'x', this.numberParam(compiledNode, 'x'));
        this.setControl(node.id, 'y', this.numberParam(compiledNode, 'y'));
        return;
      case 'audioLevel': {
        const source = this.audioInput(compiledNode, audio);
        const gain = this.numberParam(compiledNode, 'gain');
        const floor = this.numberParam(compiledNode, 'floor');
        this.setControl(
          node.id,
          'value',
          clamp((source.level - floor) * gain, 0, 1),
        );
        return;
      }
      case 'audioSpectrum': {
        const source = this.audioInput(compiledNode, audio);
        const gain = this.numberParam(compiledNode, 'gain');
        const floor = this.numberParam(compiledNode, 'floor');
        const bands = source.spectrum
          ? analyzeShapedBands(source.spectrum, {
              bass: {
                frequency: this.numberParam(compiledNode, 'bassFrequency'),
                q: this.numberParam(compiledNode, 'bassQ'),
              },
              mid: {
                frequency: this.numberParam(compiledNode, 'midFrequency'),
                q: this.numberParam(compiledNode, 'midQ'),
              },
              treble: {
                frequency: this.numberParam(compiledNode, 'trebleFrequency'),
                q: this.numberParam(compiledNode, 'trebleQ'),
              },
            })
          : source;
        const values = { level: source.level, ...bands };
        for (const band of ['level', 'bass', 'mid', 'treble'] as const) {
          this.setControl(
            node.id,
            band,
            clamp((values[band] - floor) * gain, 0, 1),
          );
        }
        return;
      }
      case 'audioTrigger': {
        const previous =
          this.audioOnsetStates.get(node.id) ?? createAudioOnsetState();
        const result = evaluateAudioOnset(previous, {
          value: this.controlInput(compiledNode, 'value', audio.frame.level),
          time,
          threshold: this.numberParam(compiledNode, 'threshold'),
          sensitivity: this.numberParam(compiledNode, 'sensitivity'),
          hold: this.numberParam(compiledNode, 'hold'),
          decay: this.numberParam(compiledNode, 'decay'),
        });
        this.audioOnsetStates.set(node.id, result.state);
        this.setControl(node.id, 'trigger', result.trigger);
        this.setControl(node.id, 'envelope', result.envelope);
        return;
      }
      case 'audioBeat': {
        const restingBpm = this.numberParam(compiledNode, 'restingBpm');
        const previous =
          this.audioBeatStates.get(node.id) ?? createAudioBeatState(restingBpm);
        const result = evaluateAudioBeat(previous, {
          trigger: this.controlInput(compiledNode, 'trigger', 0),
          time,
          restingBpm,
          minBpm: this.numberParam(compiledNode, 'minBpm'),
          maxBpm: this.numberParam(compiledNode, 'maxBpm'),
          beatsPerBar: this.numberParam(compiledNode, 'beatsPerBar'),
          pulseWidth: this.numberParam(compiledNode, 'pulseWidth'),
          lock: this.numberParam(compiledNode, 'lock'),
        });
        this.audioBeatStates.set(node.id, result.state);
        this.setControl(node.id, 'phase', result.phase);
        this.setControl(node.id, 'beat', result.beat);
        this.setControl(node.id, 'bar', result.bar);
        this.setControl(node.id, 'bpm', result.bpm);
        this.setControl(node.id, 'confidence', result.confidence);
        return;
      }
      default:
        return;
    }
  }

  private renderFrameNode(
    compiledNode: CompiledNode,
    time: number,
  ): FrameStateCommit | null {
    const resources = this.nodeResources.get(compiledNode.node.id);
    if (!resources || resources.targets.length === 0) {
      throw new RendererError(
        `No offscreen frame exists for node "${compiledNode.node.id}".`,
      );
    }

    if (compiledNode.node.kind === 'particleTransition') {
      const target = resources.targets[0];
      const intermediate = resources.targets[1];
      if (!target || !intermediate) throw new RendererError('Particle Transition requires two targets.');
      const value = (id: string) => {
        const parameter = compiledNode.definition.params[id];
        if (parameter?.type !== 'number') throw new RendererError('Invalid particle parameter.');
        return clamp(this.controlInput(compiledNode, id, this.numberParam(compiledNode, id)), parameter.min, parameter.max);
      };
      const background = this.beginPass('particleTransition', intermediate);
      this.bindTexture(background, 'uSource', this.frameInput(compiledNode, 'map', true), 0);
      this.uniform1f(background, 'uMix', value('mix'));
      this.draw(background);
      this.particleTransition ??= new ParticleTransition(this.gl);
      this.particleTransition.render(this.frameInput(compiledNode, 'source', true), value('mix'), value('density'), value('scatter'), value('seed'));
      const conversion = this.beginPass('render3d', target);
      this.bindTexture(conversion, 'uSource', intermediate.texture, 0);
      this.draw(conversion);
      this.outputTextures.set(compiledNode.node.id, target.texture);
      return null;
    }

    if (compiledNode.node.kind === 'render3d') {
      const target = resources.targets[0];
      const intermediate = resources.targets[1];
      if (!target || !intermediate) throw new RendererError('Render 3D requires color and conversion targets.');
      const input = (id: string): Scene3DValue => {
        const binding = compiledNode.inputs[id];
        return binding ? this.sceneValues.get(this.controlKey(binding.sourceNodeId, binding.sourcePortId)) ?? null : null;
      };
      const textureBinding = compiledNode.inputs.texture;
      const texture = textureBinding ? this.outputTextures.get(textureBinding.sourceNodeId) : undefined;
      const sourceTarget = textureBinding ? this.nodeResources.get(textureBinding.sourceNodeId)?.targets.find((candidate) => candidate.texture === texture) : undefined;
      this.sceneRenderer ??= new Scene3DRenderer(this.gl, this.canvas);
      this.sceneRenderer.render(compiledNode.node.id, {
        geometry: input('geometry') as Geometry3DValue | null,
        points: input('points') as Geometry3DValue | null,
        material: input('material') as Material3DValue | undefined ?? undefined,
        camera: input('camera') as Camera3DValue | undefined ?? undefined,
        lights: [input('light'), input('light2'), input('light3')].filter((value) => value !== null) as Light3DValue[],
      }, this.renderWidth, this.renderHeight, intermediate.framebuffer, sourceTarget?.framebuffer);
      const program = this.beginPass('render3d', target);
      this.bindTexture(program, 'uSource', intermediate.texture, 0);
      this.draw(program);
      this.outputTextures.set(compiledNode.node.id, target.texture);
      return null;
    }

    if (compiledNode.node.kind === 'feedbackSpiral') {
      const writeTarget = resources.targets[resources.nextTargetIndex];
      const previousTarget = resources.targets[1 - resources.nextTargetIndex];
      if (!writeTarget || !previousTarget) {
        throw new RendererError(
          'The Spiral Feedback node requires two frame buffers.',
        );
      }

      const previousTime = resources.lastCommitTime;
      const historyReady = previousTime !== null && time >= previousTime;
      const elapsed = historyReady ? time - previousTime : 0;
      const feedback = clamp(
        this.controlInput(
          compiledNode,
          'feedback',
          this.numberParam(compiledNode, 'feedback'),
        ),
        0,
        0.99,
      );
      const rotation = clamp(
        this.controlInput(
          compiledNode,
          'rotation',
          this.numberParam(compiledNode, 'rotation'),
        ),
        -360,
        360,
      );
      const zoom = clamp(
        this.controlInput(
          compiledNode,
          'zoom',
          this.numberParam(compiledNode, 'zoom'),
        ),
        0.5,
        2,
      );
      const poweredZoom = Math.pow(zoom, elapsed);
      const zoomStep = clamp(
        finiteOr(poweredZoom, zoom >= 1 ? 10_000 : 0.0001),
        0.0001,
        10_000,
      );
      const rotationDegrees = finiteOr((rotation * elapsed) % 360, 0);
      const program = this.beginPass('feedbackSpiral', writeTarget);
      this.bindTexture(
        program,
        'uSource',
        this.frameInput(compiledNode, 'source'),
        0,
      );
      this.bindTexture(program, 'uPrevious', previousTarget.texture, 1);
      this.uniform2f(
        program,
        'uCenter',
        clamp(
          this.controlInput(
            compiledNode,
            'centerX',
            this.numberParam(compiledNode, 'centerX'),
          ),
          0,
          1,
        ),
        clamp(
          this.controlInput(
            compiledNode,
            'centerY',
            this.numberParam(compiledNode, 'centerY'),
          ),
          0,
          1,
        ),
      );
      this.uniform1f(
        program,
        'uRotationStep',
        (rotationDegrees * Math.PI) / 180,
      );
      this.uniform1f(program, 'uZoomStep', zoomStep);
      const retention = !historyReady
        ? 0
        : elapsed === 0
          ? 1
          : feedback === 0
            ? 0
            : Math.pow(feedback, elapsed);
      this.uniform1f(program, 'uRetention', retention);
      this.uniform1f(program, 'uDeltaTime', elapsed);
      this.uniform1f(program, 'uHistoryReady', historyReady ? 1 : 0);
      this.draw(program);
      this.outputTextures.set(compiledNode.node.id, writeTarget.texture);
      if (historyReady && elapsed === 0) {
        return null;
      }
      return () => {
        resources.nextTargetIndex = 1 - resources.nextTargetIndex;
        resources.lastCommitTime = time;
      };
    }

    if (compiledNode.node.kind === 'trails') {
      const writeTarget = resources.targets[resources.nextTargetIndex];
      const previousTarget = resources.targets[1 - resources.nextTargetIndex];
      if (!writeTarget || !previousTarget) {
        throw new RendererError('The Trails node requires two frame buffers.');
      }
      const program = this.beginPass('trails', writeTarget);
      this.bindTexture(
        program,
        'uSource',
        this.frameInput(compiledNode, 'source'),
        0,
      );
      this.bindTexture(program, 'uPrevious', previousTarget.texture, 1);
      this.uniform1f(
        program,
        'uFeedback',
        clamp(
          this.controlInput(
            compiledNode,
            'feedback',
            this.numberParam(compiledNode, 'feedback'),
          ),
          0,
          0.99,
        ),
      );
      this.draw(program);
      this.outputTextures.set(compiledNode.node.id, writeTarget.texture);
      return () => {
        resources.nextTargetIndex = 1 - resources.nextTargetIndex;
      };
    }

    const target = resources.targets[0];
    if (!target) {
      throw new RendererError('The frame target is unavailable.');
    }
    const kind = compiledNode.node.kind;
    const program = this.beginPass(kind, target, kind === 'shaderSource' ? this.customShaderProgram(compiledNode) : undefined);

    switch (kind) {
      case 'liquidMetaballs': {
        const values: Record<string, number> = {};
        for (const [id, parameter] of Object.entries(compiledNode.definition.params)) {
          if (parameter.type !== 'number') continue;
          const value = clamp(this.controlInput(compiledNode, id, this.numberParam(compiledNode, id)), parameter.min, parameter.max);
          values[id] = value;
          this.uniform1f(program, `u${id.charAt(0).toUpperCase()}${id.slice(1)}`, value);
        }
        let simulation = this.liquidSimulations.get(compiledNode.node.id);
        if (!simulation) { simulation = new LiquidSimulation(); this.liquidSimulations.set(compiledNode.node.id, simulation); }
        const positions = simulation.update(time, {
          count: values.count!, seed: values.seed!, radius: values.radius!, attraction: values.attraction!, pointerX: values.pointerX!, pointerY: values.pointerY!,
        });
        this.gl.uniform2fv(this.uniformLocation(program, 'uPositions[0]'), positions);
        this.bindTexture(program, 'uSource', this.frameInput(compiledNode, 'source', true), 0);
        break;
      }
      case 'chromaticAberration':
      case 'liquidMorph':
      case 'bloom':
      case 'scanlines':
      case 'levels':
      case 'hsv':
      case 'lumaKey':
      case 'chromaKey':
      case 'crossfade':
      case 'displace':
      case 'edge':
      case 'pixelate':
      case 'kaleidoscope':
      case 'channelShuffle':
        this.bindTexture(program, 'uSource', this.frameInput(compiledNode, 'source', true), 0);
        this.bindTexture(program, 'uMap', this.frameInput(compiledNode, 'map', true), 1);
        this.uniform1f(program, 'uHasMap', compiledNode.inputs.map ? 1 : 0);
        for (const [id, parameter] of Object.entries(compiledNode.definition.params)) {
          const uniform = `u${id.charAt(0).toUpperCase()}${id.slice(1)}`;
          if (parameter.type === 'number') {
            this.uniform1f(program, uniform, clamp(
              this.controlInput(compiledNode, id, this.numberParam(compiledNode, id)),
              parameter.min, parameter.max,
            ));
          } else if (parameter.type === 'select') {
            this.uniform1f(program, uniform, parameter.options.findIndex(
              ({ value }) => value === this.stringParam(compiledNode, id),
            ));
          }
        }
        break;
      case 'shaderSource':
        this.uniform1f(program, 'uTime', this.controlInput(compiledNode, 'time', time));
        for (let index = 1; index <= 4; index++) {
          this.uniform1f(program, `uValue${index}`, this.controlInput(compiledNode, `value${index}`, this.numberParam(compiledNode, `value${index}`)));
        }
        break;
      case 'videoInput':
        this.bindTexture(
          program,
          'uSource',
          this.videoTexture ?? this.fallbackTexture(),
          0,
        );
        this.uniform2f(
          program,
          'uSourceSize',
          this.videoSourceWidth,
          this.videoSourceHeight,
        );
        this.uniform1f(
          program,
          'uFit',
          videoFitIndex(this.stringParam(compiledNode, 'fit')),
        );
        this.uniform1f(
          program,
          'uMirror',
          this.stringParam(compiledNode, 'mirror') === 'on' ? 1 : 0,
        );
        break;
      case 'networkVideo': {
        const texture = this.uploadVideoModelFrame(compiledNode.node.id);
        const source = this.videoModelSources.get(compiledNode.node.id);
        const size = source instanceof HTMLVideoElement
          ? readVideoFrameSize(source, this.maxTextureDimension, MAX_RENDER_PIXELS)
          : null;
        this.bindTexture(program, 'uSource', texture ?? this.transparentTexture ?? this.fallbackTexture(), 0);
        this.uniform2f(program, 'uSourceSize', size?.width ?? 1, size?.height ?? 1);
        this.uniform1f(program, 'uFit', videoFitIndex(this.stringParam(compiledNode, 'fit')));
        this.uniform1f(program, 'uMirror', this.stringParam(compiledNode, 'mirror') === 'on' ? 1 : 0);
        break;
      }
      case 'file':
        this.bindTexture(
          program,
          'uSource',
          this.videoTexture ?? this.fallbackTexture(),
          0,
        );
        this.uniform2f(
          program,
          'uSourceSize',
          this.videoSourceWidth,
          this.videoSourceHeight,
        );
        this.uniform1f(program, 'uFit', videoFitIndex('cover'));
        this.uniform1f(program, 'uMirror', 0);
        break;
      case 'videoModel': {
        const generatedTexture = this.uploadVideoModelFrame(
          compiledNode.node.id,
        );
        this.bindTexture(
          program,
          'uSource',
          this.frameInput(compiledNode, 'source'),
          0,
        );
        this.bindTexture(
          program,
          'uGenerated',
          generatedTexture ?? this.fallbackTexture(),
          1,
        );
        this.uniform1f(
          program,
          'uHasSource',
          compiledNode.inputs.source ? 1 : 0,
        );
        this.uniform1f(program, 'uHasGenerated', generatedTexture ? 1 : 0);
        this.uniform1f(program, 'uTime', time);
        this.uniform1f(
          program,
          'uStrength',
          this.numberParam(compiledNode, 'strength'),
        );
        this.uniform1f(
          program,
          'uGuidance',
          this.numberParam(compiledNode, 'guidance'),
        );
        this.uniform1f(program, 'uSeed', this.numberParam(compiledNode, 'seed'));
        break;
      }
      case 'gradient': {
        const value = (paramId: string, min: number, max: number) => clamp(
          this.controlInput(compiledNode, paramId, this.numberParam(compiledNode, paramId)), min, max,
        );
        this.uniform2f(program, 'uCenter', value('x', 0, 1), value('y', 0, 1));
        this.uniform1f(program, 'uAngle', value('angle', -180, 180) * Math.PI / 180);
        this.uniform1f(program, 'uRadius', value('radius', 0.01, 2));
        this.uniform1f(program, 'uMode', Math.max(0, ['linear', 'radial', 'conic'].indexOf(this.stringParam(compiledNode, 'mode'))));
        const stops = getGradientStops(compiledNode.node.params);
        this.uniform1f(program, 'uStopCount', stops.length);
        stops.forEach((stop, index) => {
          this.uniform1f(program, `uPositions[${index}]`, stop.position);
          this.uniform4f(program, `uColors[${index}]`, stop.red, stop.green, stop.blue, stop.alpha);
        });
        break;
      }
      case 'solid':
        this.uniform4f(
          program,
          'uColor',
          clamp(
            this.controlInput(
              compiledNode,
              'red',
              this.numberParam(compiledNode, 'red'),
            ),
            0,
            1,
          ),
          clamp(
            this.controlInput(
              compiledNode,
              'green',
              this.numberParam(compiledNode, 'green'),
            ),
            0,
            1,
          ),
          clamp(
            this.controlInput(
              compiledNode,
              'blue',
              this.numberParam(compiledNode, 'blue'),
            ),
            0,
            1,
          ),
          clamp(
            this.controlInput(
              compiledNode,
              'alpha',
              this.numberParam(compiledNode, 'alpha'),
            ),
            0,
            1,
          ),
        );
        break;
      case 'text': {
        const params = { ...compiledNode.node.params };
        const binding = compiledNode.inputs.text;
        params.text = binding
          ? this.textValues.get(this.controlKey(binding.sourceNodeId, binding.sourcePortId)) ?? ''
          : this.textParam(compiledNode, 'text');
        for (const paramId of ['x', 'y', 'fontSize', 'alpha']) {
          const parameter = compiledNode.definition.params[paramId];
          if (parameter?.type === 'number') {
            params[paramId] = clamp(this.controlInput(compiledNode, paramId, this.numberParam(compiledNode, paramId)), parameter.min, parameter.max);
          }
        }
        const frame = this.textFrames.get(compiledNode.node.id, params, this.renderWidth, this.renderHeight);
        const sourceTarget = resources.targets[1];
        if (!sourceTarget) throw new RendererError('The text source texture is missing.');
        if (frame.dirty) {
          const gl = this.gl;
          gl.bindTexture(gl.TEXTURE_2D, sourceTarget.texture);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
          try {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, frame.image);
            frame.dirty = false;
          } finally {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
            gl.bindTexture(gl.TEXTURE_2D, null);
          }
        }
        this.bindTexture(program, 'uSource', sourceTarget.texture, 0);
        break;
      }
      case 'vectorShape': {
        const frame = this.vectorFrames.get(compiledNode.node.id, this.textParam(compiledNode, 'artwork'), this.renderWidth, this.renderHeight);
        const sourceTarget = resources.targets[1];
        if (!sourceTarget) throw new RendererError('The vector source texture is missing.');
        if (frame?.dirty) {
          const gl = this.gl;
          gl.bindTexture(gl.TEXTURE_2D, sourceTarget.texture);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
          try {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, frame.image);
            frame.dirty = false;
          } finally {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
            gl.bindTexture(gl.TEXTURE_2D, null);
          }
        }
        this.bindTexture(program, 'uSource', frame ? sourceTarget.texture : this.transparentTexture ?? this.fallbackTexture(), 0);
        break;
      }
      case 'shape': {
        const value = (paramId: string, min: number, max: number) => clamp(
          this.controlInput(compiledNode, paramId, this.numberParam(compiledNode, paramId)), min, max,
        );
        this.uniform2f(program, 'uCenter', value('x', 0, 1), value('y', 0, 1));
        this.uniform2f(program, 'uSize', value('width', 0.01, 2), value('height', 0.01, 2));
        this.uniform1f(program, 'uRotation', value('rotation', -180, 180) * Math.PI / 180);
        this.uniform1f(program, 'uPrimitive', Math.max(0, ['ellipse', 'rectangle', 'triangle', 'polygon', 'star'].indexOf(this.stringParam(compiledNode, 'primitive'))));
        this.uniform1f(program, 'uSides', Math.round(value('sides', 3, 12)));
        this.uniform1f(program, 'uOutline', this.stringParam(compiledNode, 'style') === 'outline' ? 1 : 0);
        this.uniform1f(program, 'uThickness', value('thickness', 0.001, 0.2));
        this.uniform4f(program, 'uColor', value('red', 0, 1), value('green', 0, 1), value('blue', 0, 1), value('alpha', 0, 1));
        break;
      }
      case 'noise': {
        this.uniform1f(program, 'uTime', this.controlInput(compiledNode, 'time', time) * this.numberParam(compiledNode, 'speed'));
        this.uniform1f(program, 'uScale', clamp(this.controlInput(compiledNode, 'scale', this.numberParam(compiledNode, 'scale')), 0.1, 64));
        this.uniform1f(program, 'uAlpha', clamp(this.controlInput(compiledNode, 'alpha', this.numberParam(compiledNode, 'alpha')), 0, 1));
        this.uniform1f(program, 'uMode', Math.max(0, ['value', 'simplex', 'cellular', 'curl', 'fractal'].indexOf(this.stringParam(compiledNode, 'mode'))));
        this.uniform1f(program, 'uFractalType', Math.max(0, ['fbm', 'turbulence', 'ridged'].indexOf(this.stringParam(compiledNode, 'fractalType'))));
        this.uniform1f(program, 'uSeed', Math.round(this.numberParam(compiledNode, 'seed')));
        this.uniform1f(program, 'uOctaves', Math.round(this.numberParam(compiledNode, 'octaves')));
        for (const paramId of ['persistence', 'lacunarity', 'contrast', 'brightness']) {
          this.uniform1f(program, `u${paramId.charAt(0).toUpperCase()}${paramId.slice(1)}`, this.numberParam(compiledNode, paramId));
        }
        break;
      }
      case 'plasma': {
        const phase = this.controlInput(compiledNode, 'time', time);
        const speed = this.numberParam(compiledNode, 'speed');
        this.uniform1f(program, 'uTime', phase * speed);
        this.uniform1f(program, 'uScale', this.numberParam(compiledNode, 'scale'));
        this.uniform1f(
          program,
          'uEnergy',
          clamp(
            this.controlInput(
              compiledNode,
              'energy',
              this.numberParam(compiledNode, 'energy'),
            ),
            0,
            1,
          ),
        );
        this.uniform1f(program, 'uHue', this.numberParam(compiledNode, 'hue'));
        break;
      }
      case 'cells': {
        const phase = this.controlInput(compiledNode, 'time', time);
        this.uniform1f(
          program,
          'uTime',
          phase * this.numberParam(compiledNode, 'speed'),
        );
        this.uniform1f(program, 'uScale', this.numberParam(compiledNode, 'scale'));
        this.uniform1f(
          program,
          'uContrast',
          this.numberParam(compiledNode, 'contrast'),
        );
        break;
      }
      case 'transform2d': {
        this.bindTexture(
          program,
          'uSource',
          this.frameInput(compiledNode, 'source'),
          0,
        );
        this.uniform2f(
          program,
          'uTranslate',
          clamp(
            this.controlInput(
              compiledNode,
              'x',
              this.numberParam(compiledNode, 'x'),
            ),
            -1,
            1,
          ),
          clamp(
            this.controlInput(
              compiledNode,
              'y',
              this.numberParam(compiledNode, 'y'),
            ),
            -1,
            1,
          ),
        );
        this.uniform1f(
          program,
          'uScale',
          clamp(
            this.controlInput(
              compiledNode,
              'scale',
              this.numberParam(compiledNode, 'scale'),
            ),
            0.1,
            4,
          ),
        );
        this.uniform1f(
          program,
          'uRotation',
          (clamp(
            this.controlInput(
              compiledNode,
              'rotation',
              this.numberParam(compiledNode, 'rotation'),
            ),
            -180,
            180,
          ) *
            Math.PI) /
            180,
        );
        this.uniform2f(
          program,
          'uPivot',
          clamp(this.numberParam(compiledNode, 'pivotX'), 0, 1),
          clamp(this.numberParam(compiledNode, 'pivotY'), 0, 1),
        );
        this.uniform1f(
          program,
          'uEdgeMode',
          transformEdgeModeIndex(this.stringParam(compiledNode, 'edgeMode')),
        );
        break;
      }
      case 'projectorMapping': {
        this.bindTexture(
          program,
          'uSource',
          this.frameInput(compiledNode, 'source'),
          0,
        );
        const projectionMap = computeInverseProjectionMap({
          x0: this.numberParam(compiledNode, 'x0'),
          y0: this.numberParam(compiledNode, 'y0'),
          x1: this.numberParam(compiledNode, 'x1'),
          y1: this.numberParam(compiledNode, 'y1'),
          x2: this.numberParam(compiledNode, 'x2'),
          y2: this.numberParam(compiledNode, 'y2'),
          x3: this.numberParam(compiledNode, 'x3'),
          y3: this.numberParam(compiledNode, 'y3'),
          offsetX: clamp(
            this.numberParam(compiledNode, 'offsetX'),
            -0.5,
            0.5,
          ),
          offsetY: clamp(
            this.numberParam(compiledNode, 'offsetY'),
            -0.5,
            0.5,
          ),
          scale: clamp(this.numberParam(compiledNode, 'scale'), 0.1, 3),
          rotation: clamp(
            this.numberParam(compiledNode, 'rotation'),
            -180,
            180,
          ),
        });
        const mapRows = projectionMap ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
        this.uniform4f(program, 'uMapRow0', mapRows[0] ?? 1, mapRows[1] ?? 0, mapRows[2] ?? 0, 0);
        this.uniform4f(program, 'uMapRow1', mapRows[3] ?? 0, mapRows[4] ?? 1, mapRows[5] ?? 0, 0);
        this.uniform4f(program, 'uMapRow2', mapRows[6] ?? 0, mapRows[7] ?? 0, mapRows[8] ?? 1, 0);
        this.uniform1f(
          program,
          'uEdgeMode',
          transformEdgeModeIndex(this.stringParam(compiledNode, 'edgeMode')),
        );
        break;
      }
      case 'warp':
        this.bindTexture(
          program,
          'uSource',
          this.frameInput(compiledNode, 'source'),
          0,
        );
        this.uniform1f(
          program,
          'uAmount',
          clamp(
            this.controlInput(
              compiledNode,
              'amount',
              this.numberParam(compiledNode, 'amount'),
            ),
            0,
            1,
          ),
        );
        this.uniform1f(
          program,
          'uFrequency',
          this.numberParam(compiledNode, 'frequency'),
        );
        this.uniform1f(
          program,
          'uTime',
          time * this.numberParam(compiledNode, 'speed'),
        );
        break;
      case 'blur':
        this.bindTexture(
          program,
          'uSource',
          this.frameInput(compiledNode, 'source'),
          0,
        );
        this.uniform1f(
          program,
          'uRadius',
          clamp(
            this.controlInput(
              compiledNode,
              'radius',
              this.numberParam(compiledNode, 'radius'),
            ),
            0,
            24,
          ),
        );
        break;
      case 'threshold':
        this.bindTexture(
          program,
          'uSource',
          this.frameInput(compiledNode, 'source'),
          0,
        );
        this.uniform1f(
          program,
          'uChannel',
          channelIndex(this.stringParam(compiledNode, 'channel')),
        );
        this.uniform1f(
          program,
          'uLevel',
          clamp(
            this.controlInput(
              compiledNode,
              'level',
              this.numberParam(compiledNode, 'level'),
            ),
            0,
            1,
          ),
        );
        this.uniform1f(
          program,
          'uSoftness',
          clamp(
            this.controlInput(
              compiledNode,
              'softness',
              this.numberParam(compiledNode, 'softness'),
            ),
            0,
            0.5,
          ),
        );
        this.uniform1f(
          program,
          'uInvert',
          this.stringParam(compiledNode, 'invert') === 'on' ? 1 : 0,
        );
        break;
      case 'mask':
        this.bindTexture(
          program,
          'uSource',
          this.frameInput(compiledNode, 'source'),
          0,
        );
        this.bindTexture(
          program,
          'uMask',
          this.frameInput(compiledNode, 'mask'),
          1,
        );
        this.uniform1f(
          program,
          'uChannel',
          channelIndex(this.stringParam(compiledNode, 'channel')),
        );
        this.uniform1f(
          program,
          'uAmount',
          clamp(
            this.controlInput(
              compiledNode,
              'amount',
              this.numberParam(compiledNode, 'amount'),
            ),
            0,
            1,
          ),
        );
        this.uniform1f(
          program,
          'uInvert',
          this.stringParam(compiledNode, 'invert') === 'on' ? 1 : 0,
        );
        break;
      case 'composite':
        this.bindTexture(
          program,
          'uBackground',
          this.frameInput(compiledNode, 'background'),
          0,
        );
        this.bindTexture(
          program,
          'uForeground',
          this.frameInput(compiledNode, 'foreground'),
          1,
        );
        this.uniform1f(
          program,
          'uOpacity',
          clamp(
            this.controlInput(
              compiledNode,
              'opacity',
              this.numberParam(compiledNode, 'opacity'),
            ),
            0,
            1,
          ),
        );
        this.uniform1f(
          program,
          'uOperation',
          compositeOperationIndex(
            this.stringParam(compiledNode, 'operation'),
          ),
        );
        break;
      case 'frameSwitch':
        this.bindTexture(
          program,
          'uA',
          this.frameInput(compiledNode, 'a', true),
          0,
        );
        this.bindTexture(
          program,
          'uB',
          this.frameInput(compiledNode, 'b', true),
          1,
        );
        this.bindTexture(
          program,
          'uC',
          this.frameInput(compiledNode, 'c', true),
          2,
        );
        this.bindTexture(
          program,
          'uD',
          this.frameInput(compiledNode, 'd', true),
          3,
        );
        this.uniform1f(
          program,
          'uIndex',
          Math.round(
            clamp(
              this.controlInput(
                compiledNode,
                'index',
                this.numberParam(compiledNode, 'index'),
              ),
              0,
              3,
            ),
          ),
        );
        break;
      case 'sourceSelector': {
        this.bindTexture(
          program,
          'uA',
          this.frameInput(compiledNode, 'a', true),
          0,
        );
        this.bindTexture(
          program,
          'uB',
          this.frameInput(compiledNode, 'b', true),
          1,
        );
        this.bindTexture(
          program,
          'uC',
          this.frameInput(compiledNode, 'c', true),
          2,
        );
        this.bindTexture(
          program,
          'uD',
          this.frameInput(compiledNode, 'd', true),
          3,
        );
        const paramIndex = Math.round(
          clamp(this.numberParam(compiledNode, 'index'), 0, 3),
        );
        const trigger = this.controlInput(compiledNode, 'trigger', 0);
        const nodeId = compiledNode.node.id;
        const previous = this.sourceSelectorStates.get(nodeId) ?? {
          index: paramIndex,
          lastTrigger: 0,
          lastParam: paramIndex,
        };
        let index = previous.index;
        if (paramIndex !== previous.lastParam) {
          index = paramIndex;
        }
        if (previous.lastTrigger < 0.5 && trigger >= 0.5) {
          index = (index + 1) % 4;
        }
        this.sourceSelectorStates.set(nodeId, {
          index,
          lastTrigger: trigger,
          lastParam: paramIndex,
        });
        this.uniform1f(program, 'uIndex', index);
        break;
      }
      case 'blend':
        this.bindTexture(
          program,
          'uA',
          this.frameInput(compiledNode, 'a'),
          0,
        );
        this.bindTexture(
          program,
          'uB',
          this.frameInput(compiledNode, 'b'),
          1,
        );
        this.uniform1f(
          program,
          'uMix',
          clamp(
            this.controlInput(
              compiledNode,
              'mix',
              this.numberParam(compiledNode, 'mix'),
            ),
            0,
            1,
          ),
        );
        this.uniform1f(
          program,
          'uMode',
          modeIndex(this.stringParam(compiledNode, 'mode')),
        );
        break;
      case 'strobe': {
        this.bindTexture(
          program,
          'uSource',
          this.frameInput(compiledNode, 'source'),
          0,
        );
        const phase = compiledNode.inputs.phase
          ? normalizeStrobePhase(
              this.controlInput(compiledNode, 'phase', 0),
            )
          : evaluateInternalStrobePhase(
              time,
              this.numberParam(compiledNode, 'rate'),
            );
        this.uniform1f(program, 'uPhase', phase);
        this.uniform1f(
          program,
          'uDuty',
          clamp(this.numberParam(compiledNode, 'duty'), 0.05, 0.95),
        );
        this.uniform1f(
          program,
          'uAmount',
          this.controlInput(
            compiledNode,
            'amount',
            this.booleanParam(compiledNode, 'amount') ? 1 : 0,
          ) > 0.5
            ? 1
            : 0,
        );
        this.uniform1f(
          program,
          'uClosedMode',
          strobeClosedModeIndex(
            this.stringParam(compiledNode, 'closedMode'),
          ),
        );
        break;
      }
      case 'colorGrade':
        this.bindTexture(
          program,
          'uSource',
          this.frameInput(compiledNode, 'source'),
          0,
        );
        this.uniform1f(
          program,
          'uHue',
          clamp(
            this.controlInput(
              compiledNode,
              'hue',
              this.numberParam(compiledNode, 'hue'),
            ),
            -1,
            1,
          ),
        );
        this.uniform1f(
          program,
          'uExposure',
          clamp(
            this.controlInput(
              compiledNode,
              'exposure',
              this.numberParam(compiledNode, 'exposure'),
            ),
            -2,
            2,
          ),
        );
        this.uniform1f(
          program,
          'uContrast',
          this.numberParam(compiledNode, 'contrast'),
        );
        this.uniform1f(
          program,
          'uSaturation',
          clamp(
            this.controlInput(
              compiledNode,
              'saturation',
              this.numberParam(compiledNode, 'saturation'),
            ),
            0,
            3,
          ),
        );
        break;
      default:
        throw new RendererError(`Node kind "${kind}" is not a frame operator.`);
    }

    this.draw(program);
    this.outputTextures.set(compiledNode.node.id, target.texture);
    return null;
  }

  private renderDisplayNode(compiledNode: CompiledNode | undefined): void {
    if (!compiledNode) {
      this.clearDisplay();
      return;
    }
    const program = this.beginPass('display', null);
    this.bindTexture(
      program,
      'uSource',
      this.frameInput(compiledNode, 'source'),
      0,
    );
    this.draw(program);
  }

  private beginPass(
    kind: NodeKind,
    target: RenderTarget | null,
    override?: ProgramInfo,
  ): ProgramInfo {
    const gl = this.gl;
    const program = override ?? this.programFor(kind);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
    gl.viewport(0, 0, this.renderWidth, this.renderHeight);
    gl.useProgram(program.program);
    gl.bindVertexArray(this.vertexArray);
    this.uniform2f(program, 'uResolution', this.renderWidth, this.renderHeight);
    return program;
  }

  private draw(program: ProgramInfo): void {
    this.gl.useProgram(program.program);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  private customShaderProgram(compiledNode: CompiledNode): ProgramInfo {
    const nodeId = compiledNode.node.id;
    const source = String(compiledNode.node.params.source ?? DEFAULT_SHADER_SOURCE);
    let entry = this.shaderPrograms.get(nodeId);
    if (!entry || entry.source !== source) {
      const previous = entry?.info ?? null;
      try {
        const info = { program: this.createProgram(FULLSCREEN_VERTEX_SHADER, buildShaderSource(source)), uniforms: new Map<string, WebGLUniformLocation | null>() };
        entry = { source, info, error: null };
        if (previous) this.gl.deleteProgram(previous.program);
      } catch (error) {
        entry = { source, info: previous, error: this.asError(error).message.slice(0, 2_048) };
      }
      this.shaderPrograms.set(nodeId, entry);
    }
    if (entry.error && !this.shaderError) this.shaderError = new RendererError(`Shader Source (${nodeId}): ${entry.error}`);
    return entry.info ?? this.programFor('shaderSource');
  }

  private programFor(kind: NodeKind): ProgramInfo {
    const existing = this.programs.get(kind);
    if (existing) {
      return existing;
    }
    const fragmentSource = FRAME_FRAGMENT_SHADERS[kind];
    if (!fragmentSource) {
      throw new RendererError(`No shader is registered for "${kind}".`);
    }
    const program: ProgramInfo = {
      program: this.createProgram(FULLSCREEN_VERTEX_SHADER, fragmentSource),
      uniforms: new Map(),
    };
    this.programs.set(kind, program);
    return program;
  }

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;
    const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    let fragmentShader: WebGLShader;
    try {
      fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    } catch (error) {
      gl.deleteShader(vertexShader);
      throw error;
    }
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      throw new RendererError('Unable to create a shader program.');
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const detail = gl.getProgramInfoLog(program) ?? 'Unknown link error.';
      gl.deleteProgram(program);
      throw new RendererError(`Shader link failed: ${detail}`);
    }
    return program;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) {
      throw new RendererError('Unable to create a shader.');
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const detail = gl.getShaderInfoLog(shader) ?? 'Unknown compile error.';
      gl.deleteShader(shader);
      throw new RendererError(`Shader compilation failed: ${detail}`);
    }
    return shader;
  }

  private uniformLocation(
    program: ProgramInfo,
    name: string,
  ): WebGLUniformLocation | null {
    if (program.uniforms.has(name)) {
      return program.uniforms.get(name) ?? null;
    }
    const location = this.gl.getUniformLocation(program.program, name);
    program.uniforms.set(name, location);
    return location;
  }

  private uniform1f(program: ProgramInfo, name: string, value: number): void {
    const location = this.uniformLocation(program, name);
    if (location) {
      this.gl.uniform1f(location, finiteOr(value, 0));
    }
  }

  private uniform2f(
    program: ProgramInfo,
    name: string,
    x: number,
    y: number,
  ): void {
    const location = this.uniformLocation(program, name);
    if (location) {
      this.gl.uniform2f(location, x, y);
    }
  }

  private uniform4f(
    program: ProgramInfo,
    name: string,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    const location = this.uniformLocation(program, name);
    if (location) {
      this.gl.uniform4f(location, x, y, z, w);
    }
  }

  private bindTexture(
    program: ProgramInfo,
    name: string,
    texture: WebGLTexture,
    unit: number,
  ): void {
    const location = this.uniformLocation(program, name);
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    if (location) {
      this.gl.uniform1i(location, unit);
    }
  }

  private frameInput(
    compiledNode: CompiledNode,
    inputId: string,
    transparentFallback = false,
  ): WebGLTexture {
    const binding = compiledNode.inputs[inputId];
    const texture = binding
      ? this.outputTextures.get(binding.sourceNodeId)
      : undefined;
    if (texture) {
      return texture;
    }
    return transparentFallback
      ? this.transparentFallbackTexture()
      : this.fallbackTexture();
  }

  private fallbackTexture(): WebGLTexture {
    if (!this.blackTexture) {
      throw new RendererError('The fallback texture is unavailable.');
    }
    return this.blackTexture;
  }

  private transparentFallbackTexture(): WebGLTexture {
    if (!this.transparentTexture) {
      throw new RendererError('The transparent fallback texture is unavailable.');
    }
    return this.transparentTexture;
  }

  private controlInput(
    compiledNode: CompiledNode,
    inputId: string,
    fallback: number,
  ): number {
    const binding = compiledNode.inputs[inputId];
    if (!binding) {
      return fallback;
    }
    return (
      this.controlValues.get(
        this.controlKey(binding.sourceNodeId, binding.sourcePortId),
      ) ?? fallback
    );
  }

  /** A patched block reads its own source; an empty input falls back to the session default. */
  private audioInput(
    compiledNode: CompiledNode,
    snapshot: AudioAnalysisSnapshot,
  ): AudioAnalysisFrame {
    let current: CompiledNode | undefined = compiledNode;
    // Audio Level passes its source through, so follow the chain to the real block.
    for (let depth = 0; current && depth <= MAX_AUDIO_CHAIN_DEPTH; depth += 1) {
      const binding: CompiledInputBinding | undefined = current.inputs.audio;
      if (!binding) {
        return snapshot.frame;
      }
      const source = snapshot.sources[binding.sourceNodeId];
      if (source) {
        return source;
      }
      const upstream: CompiledNode | undefined = this.plan?.nodes.find(
        (candidate) => candidate.node.id === binding.sourceNodeId,
      );
      current = upstream?.node.kind === 'audioLevel' ? upstream : undefined;
    }
    return SILENT_AUDIO_FRAME;
  }

  private setControl(nodeId: string, portId: string, value: number): void {    this.controlValues.set(this.controlKey(nodeId, portId), finiteOr(value, 0));
  }

  private controlKey(nodeId: string, portId: string): string {
    return `${nodeId}\u0000${portId}`;
  }

  private numberParam(compiledNode: CompiledNode, id: string): number {
    const definition = compiledNode.definition.params[id];
    const fallback = this.numberDefault(definition, id, compiledNode.node.id);
    const value = compiledNode.node.params[id];
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (definition?.type !== 'number') {
        return fallback;
      }
      return clamp(value, definition.min, definition.max);
    }
    return fallback;
  }

  private booleanParam(compiledNode: CompiledNode, id: string): boolean {
    const definition = compiledNode.definition.params[id];
    const value = compiledNode.node.params[id];
    if (definition?.type !== 'boolean') {
      throw new RendererError(
        `Boolean parameter "${id}" is not defined on node "${compiledNode.node.id}".`,
      );
    }
    return typeof value === 'boolean' ? value : definition.defaultValue;
  }

  private numberDefault(
    definition: OperatorParamDefinition | undefined,
    id: string,
    nodeId: string,
  ): number {
    if (definition?.type !== 'number') {
      throw new RendererError(
        `Numeric parameter "${id}" is not defined on node "${nodeId}".`,
      );
    }
    return definition.defaultValue;
  }

  private stringParam(compiledNode: CompiledNode, id: string): string {
    const definition = compiledNode.definition.params[id];
    const value = compiledNode.node.params[id];
    if (
      typeof value === 'string' &&
      definition?.type === 'select' &&
      definition.options.some((option) => option.value === value)
    ) {
      return value;
    }
    if (definition?.type !== 'select') {
      throw new RendererError(
        `Select parameter "${id}" is not defined on node "${compiledNode.node.id}".`,
      );
    }
    return definition.defaultValue;
  }

  private textParam(compiledNode: CompiledNode, id: string): string {
    const definition = compiledNode.definition.params[id];
    if (definition?.type !== 'text') {
      throw new RendererError(`Text parameter "${id}" is not defined on node "${compiledNode.node.id}".`);
    }
    const value = compiledNode.node.params[id];
    return typeof value === 'string' ? value : definition.defaultValue;
  }

  private clearDisplay(): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.viewport(0, 0, this.renderWidth, this.renderHeight);
    this.gl.clearColor(0.008, 0.01, 0.016, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  private result(rendered: boolean, error: Error | null): RenderResult {
    return {
      rendered,
      frame: this.frameCount,
      fps: this.frameRate.value,
      passCount: this.lastPassCount,
      width: this.renderWidth,
      height: this.renderHeight,
      error: error?.message ?? null,
    };
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new RendererError('Renderer has been disposed.');
    }
  }

  private asError(error: unknown): Error {
    return error instanceof Error
      ? error
      : new RendererError(`Unknown renderer error: ${String(error)}`);
  }
}
