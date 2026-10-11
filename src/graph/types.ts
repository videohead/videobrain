export const GRAPH_SCHEMA_VERSION = 1 as const;

export const NODE_KINDS = [
  'time',
  'beatClock',
  'autoSelector',
  'oscillator',
  'constant',
  'math',
  'mapRange',
  'smooth',
  'pointer',
  'aiPrompt',
  'xyPad',
  'audioLevel',
  'audioSpectrum',
  'audioTrigger',
  'audioBeat',
  'videoInput',
  'networkVideo',
  'file',
  'audioOutput',
  'audioMixer',
  'videoModel',
  'solid',
  'gradient',
  'shape',
  'vectorShape',
  'text',
  'noise',
  'shaderSource',
  'plasma',
  'cells',
  'transform2d',
  'projectorMapping',
  'warp',
  'blur',
  'threshold',
  'mask',
  'composite',
  'frameSwitch',
  'sourceSelector',
  'blend',
  'trails',
  'feedbackSpiral',
  'strobe',
  'colorGrade',
  'chromaticAberration', 'liquidMorph', 'bloom', 'scanlines',
  'levels',
  'hsv',
  'lumaKey',
  'chromaKey',
  'crossfade',
  'displace',
  'edge',
  'pixelate',
  'kaleidoscope',
  'channelShuffle',
  'liquidMetaballs', 'particleTransition',
  'textSource', 'textFormat', 'numberToText', 'textToNumber',
  'jsonParse', 'jsonSelect', 'jsonStringify', 'csvParse', 'csvStringify',
  'tableTransform', 'tableSelect', 'tableJoin',
  'httpFetch', 'dataSocket', 'serverEvents', 'dataStorage', 'dataInspect',
  'vector2', 'vector3', 'vector4', 'splitVector2', 'splitVector3', 'splitVector4',
  'primitive3d', 'grid3d', 'transform3d', 'camera3d', 'light3d', 'material3d', 'asset3d', 'render3d',
  'controlToBool', 'boolToControl', 'compare', 'logic', 'trigger', 'eventToControl',
  'gate', 'hold', 'sampleHold', 'counter', 'random', 'timer', 'envelope', 'timedTransition', 'stepSequencer', 'cueScheduler',
  'signalNumber', 'signalText', 'signalEdge', 'signalBang',
  'display',
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export const OPERATOR_CATEGORY_IDS = [
  'timing',
  'control',
  'interaction-ai',
  'inputs',
  'generators',
  'image-processing',
  'compositing',
  'output',
  'data-text',
  'scene-3d',
] as const;

export type OperatorCategoryId = (typeof OPERATOR_CATEGORY_IDS)[number];

export type PortType = 'frame.rgba' | 'control.f32' | 'text.utf8' | 'audio.block' | 'data.json' | 'data.table'
  | 'control.vec2' | 'control.vec3' | 'control.vec4' | 'geometry.mesh' | 'geometry.points' | 'material.pbr' | 'scene.camera' | 'scene.light' | 'scene.asset'
  | 'control.bool' | 'event.trigger';

export type OperatorDomain = 'control' | 'frame' | 'audio' | 'display';

export type GraphParamValue = number | string | boolean;

export type GraphParams = Record<string, GraphParamValue>;

export interface GraphPosition {
  x: number;
  y: number;
}
export interface GraphNode {
  id: string;
  kind: NodeKind;
  position: GraphPosition;
  params: GraphParams;
}

export interface GraphEndpoint {
  nodeId: string;
  portId: string;
}

export interface GraphEdge {
  id: string;
  source: GraphEndpoint;
  target: GraphEndpoint;
}

export interface GraphDocument {
  schemaVersion: typeof GRAPH_SCHEMA_VERSION;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface PortDefinition {
  id: string;
  label: string;
  type: PortType;
  optional?: boolean;
}

export interface NumberParamDefinition {
  type: 'number';
  label: string;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
}

export interface BooleanParamDefinition {
  type: 'boolean';
  label: string;
  defaultValue: boolean;
}

export interface SelectParamOption {
  value: string;
  label: string;
}

export interface SelectParamDefinition {
  type: 'select';
  label: string;
  defaultValue: string;
  options: readonly SelectParamOption[];
}

export interface TextParamDefinition {
  type: 'text';
  label: string;
  defaultValue: string;
  maxLength: number;
  placeholder?: string;
  multiline?: boolean;
}

export type OperatorParamDefinition =
  | NumberParamDefinition
  | BooleanParamDefinition
  | SelectParamDefinition
  | TextParamDefinition;

export interface XYParameterLayout {
  type: 'xy';
  label: string;
  xParamId: string;
  yParamId: string;
}

export interface AudioBandLayoutEntry {
  id: string;
  label: string;
  frequencyParamId: string;
  qParamId: string;
}

export interface AudioBandParameterLayout {
  type: 'audio-bands';
  label: string;
  bands: readonly AudioBandLayoutEntry[];
}

export interface ProjectionEditorParameterLayout {
  type: 'projection-editor';
  label: string;
  cornerXParams: readonly [string, string, string, string];
  cornerYParams: readonly [string, string, string, string];
  offsetXParamId: string;
  offsetYParamId: string;
  scaleParamId: string;
  rotationParamId: string;
}

export interface SourceSelectorParameterLayout {
  type: 'source-selector';
  label: string;
  paramId: string;
  sources: readonly string[];
}

export type ParameterLayout =
  | { type: 'text'; label: string; fontParamId: string }
  | { type: 'gradient'; label: string }
  | { type: 'vector'; label: string; svgParamId: string }
  | XYParameterLayout
  | AudioBandParameterLayout
  | ProjectionEditorParameterLayout
  | SourceSelectorParameterLayout;

export interface OperatorExecution {
  visualPasses: number;
  renderTargets: number;
  stateful: boolean;
}

export type OperatorExecutionOverrides = Partial<OperatorExecution>;

export interface OperatorDefinition {
  kind: NodeKind;
  title: string;
  summary: string;
  domain: OperatorDomain;
  category: OperatorCategoryId;
  inputs: readonly PortDefinition[];
  outputs: readonly PortDefinition[];
  params: Readonly<Record<string, OperatorParamDefinition>>;
  parameterLayout?: ParameterLayout;
  execution?: Readonly<OperatorExecutionOverrides>;
}
