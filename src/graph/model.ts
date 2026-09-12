import {
  MAX_GRAPH_EDGES,
  MAX_GRAPH_IDENTIFIER_LENGTH,
  MAX_GRAPH_JSON_BYTES,
  MAX_GRAPH_NODES,
} from './limits';
import { getDefaultParams, getOperatorDefinition } from './operators';
import {
  GRAPH_SCHEMA_VERSION,
  NODE_KINDS,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
  type GraphParams,
  type GraphPosition,
  type NodeKind,
} from './types';

let generatedId = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new GraphDocumentError(`${path} must be an object.`);
  }
  return value;
}

function assertOnlyKeys(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  path: string,
): void {
  const allowed = new Set(keys);
  const unknownKey = Object.keys(record).find((key) => !allowed.has(key));
  if (unknownKey !== undefined) {
    throw new GraphDocumentError(`${path}.${unknownKey} is not supported.`);
  }
}

function requireString(
  value: unknown,
  path: string,
  maxLength = MAX_GRAPH_IDENTIFIER_LENGTH,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new GraphDocumentError(`${path} must be a non-empty string.`);
  }
  if (value.length > maxLength) {
    throw new GraphDocumentError(
      `${path} must be at most ${maxLength} characters.`,
    );
  }
  return value;
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new GraphDocumentError(`${path} must be a finite number.`);
  }
  return value;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertJsonSize(value: string): void {
  if (
    value.length > MAX_GRAPH_JSON_BYTES ||
    utf8ByteLength(value) > MAX_GRAPH_JSON_BYTES
  ) {
    throw new GraphDocumentError(
      `Project JSON exceeds the ${MAX_GRAPH_JSON_BYTES}-byte limit.`,
    );
  }
}

export function normalizeNodeParams(
  kind: NodeKind,
  value: unknown,
  path = 'params',
): GraphParams {
  const record = requireRecord(value, path);
  const definitions = getOperatorDefinition(kind).params;
  assertOnlyKeys(record, Object.keys(definitions), path);
  const params = getDefaultParams(kind);

  for (const [key, param] of Object.entries(record)) {
    const definition = definitions[key];
    if (!definition) {
      throw new GraphDocumentError(`${path}.${key} is not supported.`);
    }

    if (definition.type === 'number') {
      if (typeof param !== 'number' || !Number.isFinite(param)) {
        throw new GraphDocumentError(`${path}.${key} must be a finite number.`);
      }
      if (param < definition.min || param > definition.max) {
        throw new GraphDocumentError(
          `${path}.${key} must be between ${definition.min} and ${definition.max}.`,
        );
      }
      params[key] = param;
      continue;
    }

    if (definition.type === 'text') {
      if (typeof param !== 'string') {
        throw new GraphDocumentError(`${path}.${key} must be text.`);
      }
      if (param.length > definition.maxLength) {
        throw new GraphDocumentError(
          `${path}.${key} must be at most ${definition.maxLength} characters.`,
        );
      }
      params[key] = param;
      continue;
    }

    if (definition.type === 'boolean') {
      if (typeof param !== 'boolean') {
        throw new GraphDocumentError(`${path}.${key} must be boolean.`);
      }
      params[key] = param;
      continue;
    }

    if (
      typeof param !== 'string' ||
      !definition.options.some(({ value: option }) => option === param)
    ) {
      throw new GraphDocumentError(
        `${path}.${key} must be one of: ${definition.options
          .map(({ value: option }) => option)
          .join(', ')}.`,
      );
    }
    params[key] = param;
  }

  return params;
}

function parseNode(value: unknown, index: number): GraphNode {
  const path = `nodes[${index}]`;
  const record = requireRecord(value, path);
  assertOnlyKeys(record, ['id', 'kind', 'position', 'params'], path);
  const kindValue = requireString(record.kind, `${path}.kind`);

  if (!NODE_KINDS.includes(kindValue as NodeKind)) {
    throw new GraphDocumentError(`${path}.kind is not a registered node kind.`);
  }

  const position = requireRecord(record.position, `${path}.position`);
  assertOnlyKeys(position, ['x', 'y'], `${path}.position`);
  return {
    id: requireString(record.id, `${path}.id`),
    kind: kindValue as NodeKind,
    position: {
      x: requireFiniteNumber(position.x, `${path}.position.x`),
      y: requireFiniteNumber(position.y, `${path}.position.y`),
    },
    params: normalizeNodeParams(
      kindValue as NodeKind,
      record.params,
      `${path}.params`,
    ),
  };
}

function parseEndpoint(
  value: unknown,
  path: string,
): { nodeId: string; portId: string } {
  const record = requireRecord(value, path);
  assertOnlyKeys(record, ['nodeId', 'portId'], path);
  return {
    nodeId: requireString(record.nodeId, `${path}.nodeId`),
    portId: requireString(record.portId, `${path}.portId`),
  };
}

function parseEdge(value: unknown, index: number): GraphEdge {
  const path = `edges[${index}]`;
  const record = requireRecord(value, path);
  assertOnlyKeys(record, ['id', 'source', 'target'], path);
  return {
    id: requireString(record.id, `${path}.id`),
    source: parseEndpoint(record.source, `${path}.source`),
    target: parseEndpoint(record.target, `${path}.target`),
  };
}

function assertUniqueIds(items: readonly { id: string }[], path: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new GraphDocumentError(`${path} contains duplicate id "${item.id}".`);
    }
    seen.add(item.id);
  }
}

function nextId(kind: NodeKind): string {
  generatedId += 1;
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId ?? `${kind}-${Date.now().toString(36)}-${generatedId.toString(36)}`;
}

export class GraphDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphDocumentError';
  }
}

export function createGraphNode(
  kind: NodeKind,
  position: GraphPosition,
  params: GraphParams = {},
  id = nextId(kind),
): GraphNode {
  return {
    id,
    kind,
    position: { ...position },
    params: normalizeNodeParams(kind, params),
  };
}

export function cloneGraphDocument(document: GraphDocument): GraphDocument {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: document.nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      params: { ...node.params },
    })),
    edges: document.edges.map((edge) => ({
      ...edge,
      source: { ...edge.source },
      target: { ...edge.target },
    })),
  };
}

export function parseGraphDocument(value: unknown): GraphDocument {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    assertJsonSize(value);
    try {
      parsed = JSON.parse(value) as unknown;
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : '';
      throw new GraphDocumentError(`Project JSON is invalid.${detail}`);
    }
  }

  const record = requireRecord(parsed, 'project');
  assertOnlyKeys(record, ['schemaVersion', 'nodes', 'edges'], 'project');
  if (record.schemaVersion !== GRAPH_SCHEMA_VERSION) {
    throw new GraphDocumentError(
      `Unsupported schema version "${String(record.schemaVersion)}".`,
    );
  }
  if (!Array.isArray(record.nodes)) {
    throw new GraphDocumentError('project.nodes must be an array.');
  }
  if (!Array.isArray(record.edges)) {
    throw new GraphDocumentError('project.edges must be an array.');
  }
  if (record.nodes.length > MAX_GRAPH_NODES) {
    throw new GraphDocumentError(
      `project.nodes exceeds the ${MAX_GRAPH_NODES}-node limit.`,
    );
  }
  if (record.edges.length > MAX_GRAPH_EDGES) {
    throw new GraphDocumentError(
      `project.edges exceeds the ${MAX_GRAPH_EDGES}-edge limit.`,
    );
  }

  const document: GraphDocument = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: record.nodes.map(parseNode),
    edges: record.edges.map(parseEdge),
  };
  assertUniqueIds(document.nodes, 'project.nodes');
  assertUniqueIds(document.edges, 'project.edges');
  return document;
}

export function serializeGraphDocument(document: GraphDocument): string {
  return JSON.stringify(parseGraphDocument(document), null, 2);
}
