import { cloneGraphDocument } from './model';
import {
  MAX_GPU_RENDER_PASSES,
  MAX_GPU_RENDER_TARGETS,
  MAX_GRAPH_EDGES,
  MAX_GRAPH_NODES,
  MAX_REACHABLE_FRAME_NODES,
} from './limits';
import { getOperatorDefinition, getOperatorExecution } from './operators';
import type {
  GraphDocument,
  GraphEdge,
  GraphEndpoint,
  GraphNode,
  OperatorDefinition,
  PortDefinition,
  PortType,
} from './types';

export type GraphIssueCode =
  | 'duplicate-node-id'
  | 'duplicate-edge-id'
  | 'source-node-missing'
  | 'target-node-missing'
  | 'source-port-missing'
  | 'target-port-missing'
  | 'port-type-mismatch'
  | 'input-occupied'
  | 'cycle'
  | 'node-limit'
  | 'edge-limit'
  | 'frame-pass-limit'
  | 'gpu-resource-limit';

export interface GraphIssue {
  code: GraphIssueCode;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface CompiledInputBinding {
  edgeId: string;
  sourceNodeId: string;
  sourcePortId: string;
  type: PortType;
}

export interface CompiledNode {
  node: GraphNode;
  definition: OperatorDefinition;
  inputs: Readonly<Record<string, CompiledInputBinding>>;
}

export interface CompiledGraph {
  document: GraphDocument;
  nodes: readonly CompiledNode[];
  controlNodes: readonly CompiledNode[];
  frameNodes: readonly CompiledNode[];
  audioNodes: readonly CompiledNode[];
  audioOutputNodes: readonly CompiledNode[];
  displayNodes: readonly CompiledNode[];
  reachableNodeIds: ReadonlySet<string>;
  visualPasses: number;
  renderTargets: number;
}

export interface ConnectionValidation {
  valid: boolean;
  code?: GraphIssueCode;
  message?: string;
}

interface ValidEdge {
  edge: GraphEdge;
  sourcePort: PortDefinition;
}

export class GraphCompileError extends Error {
  readonly issues: readonly GraphIssue[];

  constructor(issues: readonly GraphIssue[]) {
    super(issues.map((issue) => issue.message).join('\n'));
    this.name = 'GraphCompileError';
    this.issues = issues;
  }
}

function findInput(
  definition: OperatorDefinition,
  portId: string,
): PortDefinition | undefined {
  return definition.inputs.find((port) => port.id === portId);
}

function findOutput(
  definition: OperatorDefinition,
  portId: string,
): PortDefinition | undefined {
  return definition.outputs.find((port) => port.id === portId);
}

function addDuplicateIssues<T extends { id: string }>(
  items: readonly T[],
  code: 'duplicate-node-id' | 'duplicate-edge-id',
  noun: string,
  issues: GraphIssue[],
): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      issues.push({
        code,
        message: `Duplicate ${noun} id "${item.id}".`,
        ...(noun === 'node' ? { nodeId: item.id } : { edgeId: item.id }),
      });
    }
    seen.add(item.id);
  }
}

function sortedInsert(queue: string[], value: string): void {
  const index = queue.findIndex((candidate) => candidate > value);
  if (index === -1) {
    queue.push(value);
  } else {
    queue.splice(index, 0, value);
  }
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function topologicalOrder(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): { order: string[]; cycleNodeIds: string[] } {
  const ids = new Set(nodes.map((node) => node.id));
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of ids) {
    indegree.set(id, 0);
    adjacency.set(id, []);
  }
  for (const edge of edges) {
    if (!ids.has(edge.source.nodeId) || !ids.has(edge.target.nodeId)) {
      continue;
    }
    adjacency.get(edge.source.nodeId)?.push(edge.target.nodeId);
    indegree.set(edge.target.nodeId, (indegree.get(edge.target.nodeId) ?? 0) + 1);
  }
  for (const targets of adjacency.values()) {
    targets.sort();
  }

  const queue = [...ids]
    .filter((id) => indegree.get(id) === 0)
    .sort(compareIds);
  const order: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) {
      break;
    }
    order.push(id);
    for (const targetId of adjacency.get(id) ?? []) {
      const next = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, next);
      if (next === 0) {
        sortedInsert(queue, targetId);
      }
    }
  }

  return {
    order,
    cycleNodeIds: [...ids]
      .filter((id) => (indegree.get(id) ?? 0) > 0)
      .sort(compareIds),
  };
}

function reachableFromOutputs(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): Set<string> {
  const reverse = new Map<string, string[]>();
  for (const node of nodes) {
    reverse.set(node.id, []);
  }
  for (const edge of edges) {
    reverse.get(edge.target.nodeId)?.push(edge.source.nodeId);
  }
  for (const sources of reverse.values()) {
    sources.sort();
  }

  const reachable = new Set<string>();
  const pending = nodes
    .filter((node) => node.kind === 'display' || node.kind === 'audioOutput')
    .map((node) => node.id)
    .sort()
    .reverse();

  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || reachable.has(id)) {
      continue;
    }
    reachable.add(id);
    const sources = reverse.get(id) ?? [];
    for (let index = sources.length - 1; index >= 0; index -= 1) {
      const source = sources[index];
      if (source !== undefined && !reachable.has(source)) {
        pending.push(source);
      }
    }
  }
  return reachable;
}

function validateEdges(
  document: GraphDocument,
  nodeById: ReadonlyMap<string, GraphNode>,
  issues: GraphIssue[],
): ValidEdge[] {
  const validEdges: ValidEdge[] = [];
  const occupiedInputs = new Map<string, string>();

  for (const edge of document.edges) {
    const sourceNode = nodeById.get(edge.source.nodeId);
    const targetNode = nodeById.get(edge.target.nodeId);

    if (!sourceNode) {
      issues.push({
        code: 'source-node-missing',
        message: `Edge "${edge.id}" references missing source node "${edge.source.nodeId}".`,
        edgeId: edge.id,
      });
    }
    if (!targetNode) {
      issues.push({
        code: 'target-node-missing',
        message: `Edge "${edge.id}" references missing target node "${edge.target.nodeId}".`,
        edgeId: edge.id,
      });
    }
    if (!sourceNode || !targetNode) {
      continue;
    }

    const sourcePort = findOutput(
      getOperatorDefinition(sourceNode.kind),
      edge.source.portId,
    );
    const targetPort = findInput(
      getOperatorDefinition(targetNode.kind),
      edge.target.portId,
    );

    if (!sourcePort) {
      issues.push({
        code: 'source-port-missing',
        message: `Edge "${edge.id}" references missing output "${edge.source.portId}" on node "${sourceNode.id}".`,
        nodeId: sourceNode.id,
        edgeId: edge.id,
      });
    }
    if (!targetPort) {
      issues.push({
        code: 'target-port-missing',
        message: `Edge "${edge.id}" references missing input "${edge.target.portId}" on node "${targetNode.id}".`,
        nodeId: targetNode.id,
        edgeId: edge.id,
      });
    }
    if (!sourcePort || !targetPort) {
      continue;
    }

    if (sourcePort.type !== targetPort.type) {
      issues.push({
        code: 'port-type-mismatch',
        message: `Edge "${edge.id}" cannot connect ${sourcePort.type} to ${targetPort.type}.`,
        edgeId: edge.id,
      });
      continue;
    }

    const inputKey = `${targetNode.id}\u0000${targetPort.id}`;
    const occupyingEdge = occupiedInputs.get(inputKey);
    if (occupyingEdge) {
      issues.push({
        code: 'input-occupied',
        message: `Input "${targetPort.id}" on node "${targetNode.id}" is already connected by edge "${occupyingEdge}".`,
        nodeId: targetNode.id,
        edgeId: edge.id,
      });
      continue;
    }
    occupiedInputs.set(inputKey, edge.id);
    validEdges.push({ edge, sourcePort });
  }

  return validEdges;
}

export function compileGraph(document: GraphDocument): CompiledGraph {
  const snapshot = cloneGraphDocument(document);
  const issues: GraphIssue[] = [];
  if (snapshot.nodes.length > MAX_GRAPH_NODES) {
    issues.push({
      code: 'node-limit',
      message: `Graph exceeds the ${MAX_GRAPH_NODES}-node limit.`,
    });
  }
  if (snapshot.edges.length > MAX_GRAPH_EDGES) {
    issues.push({
      code: 'edge-limit',
      message: `Graph exceeds the ${MAX_GRAPH_EDGES}-edge limit.`,
    });
  }
  if (issues.length > 0) {
    throw new GraphCompileError(issues);
  }
  addDuplicateIssues(snapshot.nodes, 'duplicate-node-id', 'node', issues);
  addDuplicateIssues(snapshot.edges, 'duplicate-edge-id', 'edge', issues);

  const nodeById = new Map<string, GraphNode>();
  for (const node of snapshot.nodes) {
    if (!nodeById.has(node.id)) {
      nodeById.set(node.id, node);
    }
  }

  const validEdges = validateEdges(snapshot, nodeById, issues);
  const topology = topologicalOrder(
    [...nodeById.values()],
    validEdges.map(({ edge }) => edge),
  );
  if (topology.cycleNodeIds.length > 0) {
    issues.push({
      code: 'cycle',
      message: `Graph contains a cycle involving: ${topology.cycleNodeIds.join(', ')}. Stateful effects keep their delay internal; ordinary edges must remain acyclic.`,
    });
  }

  if (issues.length > 0) {
    throw new GraphCompileError(issues);
  }

  const inputBindings = new Map<string, Record<string, CompiledInputBinding>>();
  for (const { edge, sourcePort } of validEdges) {
    const inputs = inputBindings.get(edge.target.nodeId) ?? {};
    inputs[edge.target.portId] = {
      edgeId: edge.id,
      sourceNodeId: edge.source.nodeId,
      sourcePortId: edge.source.portId,
      type: sourcePort.type,
    };
    inputBindings.set(edge.target.nodeId, inputs);
  }

  const reachableNodeIds = reachableFromOutputs(
    [...nodeById.values()],
    validEdges.map(({ edge }) => edge),
  );
  const orderedNodes = topology.order
    .filter((id) => reachableNodeIds.has(id))
    .map((id): CompiledNode => {
      const node = nodeById.get(id);
      if (!node) {
        throw new Error(`Compiled node "${id}" disappeared.`);
      }
      return {
        node,
        definition: getOperatorDefinition(node.kind),
        inputs: Object.freeze({ ...(inputBindings.get(id) ?? {}) }),
      };
    });

  const frameNodes = orderedNodes.filter(
    ({ definition }) => definition.domain === 'frame',
  );
  const audioNodes = orderedNodes.filter(
    ({ definition }) => definition.domain === 'audio',
  );
  const audioOutputNodes = audioNodes.filter(
    ({ node }) => node.kind === 'audioOutput',
  );
  const displayNodes = orderedNodes.filter(
    ({ definition }) => definition.domain === 'display',
  );
  const passCount =
    frameNodes.reduce(
      (count, { node }) =>
        count + getOperatorExecution(node.kind).visualPasses,
      0,
    ) +
    (displayNodes.length > 0
      ? getOperatorExecution(displayNodes[0]?.node.kind ?? 'display')
          .visualPasses
      : 0);
  if (
    frameNodes.length > MAX_REACHABLE_FRAME_NODES ||
    passCount > MAX_GPU_RENDER_PASSES
  ) {
    throw new GraphCompileError([
      {
        code: 'frame-pass-limit',
        message: `Graph requires ${passCount} GPU passes; the limit is ${MAX_GPU_RENDER_PASSES}.`,
      },
    ]);
  }
  const renderTargetCount = frameNodes.reduce(
    (count, { node }) =>
      count + getOperatorExecution(node.kind).renderTargets,
    0,
  );
  if (renderTargetCount > MAX_GPU_RENDER_TARGETS) {
    throw new GraphCompileError([
      {
        code: 'gpu-resource-limit',
        message: `Graph requires ${renderTargetCount} offscreen frames; the limit is ${MAX_GPU_RENDER_TARGETS}.`,
      },
    ]);
  }

  return {
    document: snapshot,
    nodes: orderedNodes,
    controlNodes: orderedNodes.filter(
      ({ definition }) => definition.domain === 'control',
    ),
    frameNodes,
    audioNodes,
    audioOutputNodes,
    displayNodes,
    reachableNodeIds,
    visualPasses: passCount,
    renderTargets: renderTargetCount,
  };
}

export function tryCompileGraph(
  document: GraphDocument,
): { ok: true; graph: CompiledGraph } | { ok: false; issues: readonly GraphIssue[] } {
  try {
    return { ok: true, graph: compileGraph(document) };
  } catch (error) {
    if (error instanceof GraphCompileError) {
      return { ok: false, issues: error.issues };
    }
    throw error;
  }
}

function hasPath(
  document: GraphDocument,
  startNodeId: string,
  targetNodeId: string,
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of document.edges) {
    const targets = adjacency.get(edge.source.nodeId) ?? [];
    targets.push(edge.target.nodeId);
    adjacency.set(edge.source.nodeId, targets);
  }
  const seen = new Set<string>();
  const pending = [startNodeId];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined) {
      continue;
    }
    if (id === targetNodeId) {
      return true;
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    pending.push(...(adjacency.get(id) ?? []));
  }
  return false;
}

export function validateConnection(
  document: GraphDocument,
  source: GraphEndpoint,
  target: GraphEndpoint,
): ConnectionValidation {
  if (document.edges.length >= MAX_GRAPH_EDGES) {
    return {
      valid: false,
      code: 'edge-limit',
      message: `Graph has reached the ${MAX_GRAPH_EDGES}-edge limit.`,
    };
  }
  const sourceNode = document.nodes.find((node) => node.id === source.nodeId);
  if (!sourceNode) {
    return {
      valid: false,
      code: 'source-node-missing',
      message: `Source node "${source.nodeId}" does not exist.`,
    };
  }
  const targetNode = document.nodes.find((node) => node.id === target.nodeId);
  if (!targetNode) {
    return {
      valid: false,
      code: 'target-node-missing',
      message: `Target node "${target.nodeId}" does not exist.`,
    };
  }

  const sourcePort = findOutput(
    getOperatorDefinition(sourceNode.kind),
    source.portId,
  );
  if (!sourcePort) {
    return {
      valid: false,
      code: 'source-port-missing',
      message: `Output "${source.portId}" does not exist on "${source.nodeId}".`,
    };
  }
  const targetPort = findInput(
    getOperatorDefinition(targetNode.kind),
    target.portId,
  );
  if (!targetPort) {
    return {
      valid: false,
      code: 'target-port-missing',
      message: `Input "${target.portId}" does not exist on "${target.nodeId}".`,
    };
  }
  if (sourcePort.type !== targetPort.type) {
    return {
      valid: false,
      code: 'port-type-mismatch',
      message: `Cannot connect ${sourcePort.type} to ${targetPort.type}.`,
    };
  }
  if (
    document.edges.some(
      (edge) =>
        edge.target.nodeId === target.nodeId &&
        edge.target.portId === target.portId,
    )
  ) {
    return {
      valid: false,
      code: 'input-occupied',
      message: `Input "${target.portId}" is already connected.`,
    };
  }
  if (
    source.nodeId === target.nodeId ||
    hasPath(document, target.nodeId, source.nodeId)
  ) {
    return {
      valid: false,
      code: 'cycle',
      message: 'That connection would create a cycle.',
    };
  }

  let candidateId = '__candidate-edge__';
  while (document.edges.some(({ id }) => id === candidateId)) {
    candidateId += '_';
  }
  try {
    compileGraph({
      ...document,
      edges: [
        ...document.edges,
        {
          id: candidateId,
          source: { ...source },
          target: { ...target },
        },
      ],
    });
  } catch (error) {
    if (error instanceof GraphCompileError) {
      const issue = error.issues.find(
        ({ code }) =>
          code === 'frame-pass-limit' || code === 'gpu-resource-limit',
      );
      if (issue) {
        return {
          valid: false,
          code: issue.code,
          message: issue.message,
        };
      }
    }
    throw error;
  }
  return { valid: true };
}
