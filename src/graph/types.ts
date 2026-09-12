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
  'file',
  'audioOutput',
  'audioMixer',
  'videoModel',
  'solid',
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
] as const;

export type OperatorCategoryId = (typeof OPERATOR_CATEGORY_IDS)[number];

export type PortType = 'frame.rgba' | 'control.f32' | 'text.utf8' | 'audio.block';

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
