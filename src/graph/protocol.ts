import { tryCompileGraph, type GraphIssue } from './compiler';
import {
  MAX_GPU_RENDER_PASSES,
  MAX_GPU_RENDER_TARGETS,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_NODES,
  MAX_REACHABLE_FRAME_NODES,
} from './limits';
import { getOperatorExecution, OPERATOR_DEFINITIONS } from './operators';
import {
  GRAPH_SCHEMA_VERSION,
  OPERATOR_CATEGORY_IDS,
  type GraphDocument,
  type NodeKind,
  type OperatorCategoryId,
  type OperatorDefinition,
  type OperatorDomain,
  type OperatorExecution,
  type OperatorParamDefinition,
  type PortDefinition,
  type PortType,
  type XYParameterLayout,
} from './types';

export const GRAPH_PROTOCOL_VERSION = 1 as const;
export const OPERATOR_CATALOG_VERSION = 6 as const;

export interface OperatorCatalogPort extends PortDefinition {
  index: number;
}

export interface OperatorCatalogEntry {
  kind: NodeKind;
  title: string;
  summary: string;
  domain: OperatorDomain;
  category: OperatorCategoryId;
  inputs: OperatorCatalogPort[];
  outputs: OperatorCatalogPort[];
  params: Record<string, OperatorParamDefinition>;
  parameterLayout?: XYParameterLayout;
  execution: OperatorExecution;
}

export interface OperatorCatalogSnapshot {
  protocolVersion: typeof GRAPH_PROTOCOL_VERSION;
  graphSchemaVersion: typeof GRAPH_SCHEMA_VERSION;
  catalogVersion: typeof OPERATOR_CATALOG_VERSION;
  portTypes: readonly PortType[];
  categories: readonly OperatorCategoryId[];
  limits: {
    graphNodes: number;
    graphEdges: number;
    reachableFrameNodes: number;
    gpuPasses: number;
    gpuTargets: number;
  };
  operators: OperatorCatalogEntry[];
}

export interface GraphInspectionInput {
  targetPortId: string;
  targetPortIndex: number;
  edgeId: string;
  sourceNodeId: string;
  sourcePortId: string;
  sourcePortIndex: number;
  type: PortType;
}

export interface GraphInspectionNode {
  id: string;
  kind: NodeKind;
  domain: OperatorDomain;
  reachable: boolean;
  inputs: GraphInspectionInput[];
  execution: OperatorExecution;
}

export interface GraphInspectionResources {
  visualPasses: number;
  renderTargets: number;
  statefulNodeIds: readonly string[];
}

export interface GraphInspection {
  protocolVersion: typeof GRAPH_PROTOCOL_VERSION;
  graphSchemaVersion: typeof GRAPH_SCHEMA_VERSION;
  catalogVersion: typeof OPERATOR_CATALOG_VERSION;
  ok: boolean;
  nodeCount: number;
  edgeCount: number;
  issues: readonly GraphIssue[];
  executionOrder: readonly string[];
  controlOrder: readonly string[];
  frameOrder: readonly string[];
  displayNodeIds: readonly string[];
  inactiveNodeIds: readonly string[];
  resources: GraphInspectionResources;
  nodes: readonly GraphInspectionNode[];
}

function cloneParam(
  definition: OperatorParamDefinition,
): OperatorParamDefinition {
  if (definition.type === 'select') {
    return {
      ...definition,
      options: definition.options.map((option) => ({ ...option })),
    };
  }
  return { ...definition };
}

function catalogEntry(definition: OperatorDefinition): OperatorCatalogEntry {
  return {
    kind: definition.kind,
    title: definition.title,
    summary: definition.summary,
    domain: definition.domain,
    category: definition.category,
    inputs: definition.inputs.map((input, index) => ({ ...input, index })),
    outputs: definition.outputs.map((output, index) => ({ ...output, index })),
    params: Object.fromEntries(
      Object.entries(definition.params).map(([id, parameter]) => [
        id,
        cloneParam(parameter),
      ]),
    ),
    parameterLayout: definition.parameterLayout
      ? { ...definition.parameterLayout }
      : undefined,
    execution: getOperatorExecution(definition.kind),
  };
}

export function getOperatorCatalog(): OperatorCatalogSnapshot {
  return {
    protocolVersion: GRAPH_PROTOCOL_VERSION,
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    catalogVersion: OPERATOR_CATALOG_VERSION,
    portTypes: ['frame.rgba', 'control.f32', 'text.utf8', 'audio.block'],
    categories: [...OPERATOR_CATEGORY_IDS],
    limits: {
      graphNodes: MAX_GRAPH_NODES,
      graphEdges: MAX_GRAPH_EDGES,
      reachableFrameNodes: MAX_REACHABLE_FRAME_NODES,
      gpuPasses: MAX_GPU_RENDER_PASSES,
      gpuTargets: MAX_GPU_RENDER_TARGETS,
    },
    operators: OPERATOR_DEFINITIONS.map(catalogEntry),
  };
}

export function inspectGraph(document: GraphDocument): GraphInspection {
  const compilation = tryCompileGraph(document);
  if (!compilation.ok) {
    return {
      protocolVersion: GRAPH_PROTOCOL_VERSION,
      graphSchemaVersion: GRAPH_SCHEMA_VERSION,
      catalogVersion: OPERATOR_CATALOG_VERSION,
      ok: false,
      nodeCount: document.nodes.length,
      edgeCount: document.edges.length,
      issues: compilation.issues.map((issue) => ({ ...issue })),
      executionOrder: [],
      controlOrder: [],
      frameOrder: [],
      displayNodeIds: [],
      inactiveNodeIds: document.nodes.map(({ id }) => id).sort(),
      resources: {
        visualPasses: 0,
        renderTargets: 0,
        statefulNodeIds: [],
      },
      nodes: document.nodes
        .map((node) => ({
          id: node.id,
          kind: node.kind,
          domain: OPERATOR_DEFINITIONS.find(
            ({ kind }) => kind === node.kind,
          )?.domain ?? 'control',
          reachable: false,
          inputs: [],
          execution: getOperatorExecution(node.kind),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    };
  }

  const graph = compilation.graph;
  const definitionByKind = new Map(
    OPERATOR_DEFINITIONS.map((definition) => [definition.kind, definition]),
  );
  const nodeById = new Map(
    graph.document.nodes.map((node) => [node.id, node]),
  );
  const nodes = graph.document.nodes.map((node): GraphInspectionNode => {
    const definition = definitionByKind.get(node.kind);
    return {
      id: node.id,
      kind: node.kind,
      domain: definition?.domain ?? 'control',
      reachable: graph.reachableNodeIds.has(node.id),
      execution: getOperatorExecution(node.kind),
      inputs: graph.document.edges
        .filter((edge) => edge.target.nodeId === node.id)
        .map((edge): GraphInspectionInput => {
          const sourceNode = nodeById.get(edge.source.nodeId);
          const sourceDefinition = sourceNode
            ? definitionByKind.get(sourceNode.kind)
            : undefined;
          const sourcePortIndex =
            sourceDefinition?.outputs.findIndex(
              ({ id }) => id === edge.source.portId,
            ) ?? -1;
          const targetPortIndex =
            definition?.inputs.findIndex(
              ({ id }) => id === edge.target.portId,
            ) ?? -1;
          const sourcePort = sourceDefinition?.outputs[sourcePortIndex];
          const targetPort = definition?.inputs[targetPortIndex];
          return {
            targetPortId: edge.target.portId,
            targetPortIndex,
            edgeId: edge.id,
            sourceNodeId: edge.source.nodeId,
            sourcePortId: edge.source.portId,
            sourcePortIndex,
            type: sourcePort?.type ?? targetPort?.type ?? 'control.f32',
          };
        })
        .sort(
          (a, b) =>
            a.targetPortIndex - b.targetPortIndex ||
            a.edgeId.localeCompare(b.edgeId),
        ),
    };
  });

  return {
    protocolVersion: GRAPH_PROTOCOL_VERSION,
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
    catalogVersion: OPERATOR_CATALOG_VERSION,
    ok: true,
    nodeCount: graph.document.nodes.length,
    edgeCount: graph.document.edges.length,
    issues: [],
    executionOrder: graph.nodes.map(({ node }) => node.id),
    controlOrder: graph.controlNodes.map(({ node }) => node.id),
    frameOrder: graph.frameNodes.map(({ node }) => node.id),
    displayNodeIds: graph.displayNodes.map(({ node }) => node.id),
    inactiveNodeIds: graph.document.nodes
      .filter(({ id }) => !graph.reachableNodeIds.has(id))
      .map(({ id }) => id)
      .sort(),
    resources: {
      visualPasses: graph.visualPasses,
      renderTargets: graph.renderTargets,
      statefulNodeIds: graph.nodes
        .filter(({ node }) => getOperatorExecution(node.kind).stateful)
        .map(({ node }) => node.id),
    },
    nodes,
  };
}
