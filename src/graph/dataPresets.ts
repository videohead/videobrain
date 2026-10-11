import { createGraphNode } from './model';
import { GRAPH_SCHEMA_VERSION, type GraphDocument, type GraphEdge, type GraphNode, type GraphParams, type NodeKind } from './types';

const node = (kind: NodeKind, id: string, x: number, y: number, params: GraphParams = {}) => createGraphNode(kind, { x, y }, params, id);
const wire = (source: string, sourcePort: string, target: string, targetPort: string): GraphEdge => ({ id: `${source}-${sourcePort}-${target}-${targetPort}`, source: { nodeId: source, portId: sourcePort }, target: { nodeId: target, portId: targetPort } });
const graph = (nodes: GraphNode[], edges: GraphEdge[]): GraphDocument => ({ schemaVersion: GRAPH_SCHEMA_VERSION, nodes, edges });

export const DATA_PRESETS = [
  { id: 'json-text-lab', title: 'JSON & Text Lab', description: 'Select JSON values, convert decimal text, and format a live title.' },
  { id: 'csv-table-lab', title: 'CSV & Table Lab', description: 'Parse, join, filter, select, and serialize bounded tables.' },
  { id: 'network-data-lab', title: 'Network Data Lab', description: 'Explicit Fetch, WebSocket, and Server Events sources with no automatic network request.' },
  { id: 'storage-text-lab', title: 'Storage & Text Lab', description: 'Explicitly write, read, and delete namespaced text while inspecting the result.' },
] as const;

export const DATA_PRESET_FACTORIES = {
  'json-text-lab': () => graph([
    node('textSource', 'json-source', 0, 0, { text: '{"title":"Signal","amount":0.75}' }),
    node('jsonParse', 'json-parse', 340, 0),
    node('jsonSelect', 'json-title', 680, 0, { pointer: '/title' }),
    node('jsonStringify', 'json-title-text', 1020, 0),
    node('jsonSelect', 'json-amount', 680, 470, { pointer: '/amount' }),
    node('jsonStringify', 'json-number-text', 1020, 470),
    node('textToNumber', 'json-number', 1360, 470),
    node('numberToText', 'json-formatted', 1700, 470),
    node('textFormat', 'json-format', 2040, 0, { operation: 'join', separator: ' / ' }),
    node('text', 'json-display-text', 2380, 0),
    node('display', 'json-display', 2720, 0),
    node('dataInspect', 'json-inspect', 340, 500),
  ], [
    wire('json-source', 'text', 'json-parse', 'text'), wire('json-parse', 'json', 'json-title', 'json'),
    wire('json-title', 'json', 'json-title-text', 'json'), wire('json-title-text', 'text', 'json-format', 'text'),
    wire('json-parse', 'json', 'json-amount', 'json'), wire('json-amount', 'json', 'json-number-text', 'json'),
    wire('json-number-text', 'text', 'json-number', 'text'), wire('json-number', 'value', 'json-formatted', 'value'),
    wire('json-formatted', 'text', 'json-format', 'other'), wire('json-format', 'text', 'json-display-text', 'text'),
    wire('json-display-text', 'frame', 'json-display', 'source'), wire('json-parse', 'json', 'json-inspect', 'json'),
  ]),
  'csv-table-lab': () => graph([
    node('csvParse', 'csv-left', 0, 0, { text: 'id,name\n1,Alpha\n2,Beta' }),
    node('csvParse', 'csv-right', 0, 680, { text: 'id,value\n1,0.25\n2,0.75' }),
    node('tableJoin', 'csv-join', 340, 0),
    node('tableTransform', 'csv-filter', 680, 0, { column: 'left.name', match: 'Beta' }),
    node('tableSelect', 'csv-cell', 1020, 0, { column: 'left.name' }),
    node('text', 'csv-text', 1360, 0), node('display', 'csv-display', 1700, 0),
    node('csvStringify', 'csv-export', 1020, 500), node('dataInspect', 'csv-inspect', 1360, 790),
  ], [
    wire('csv-left', 'table', 'csv-join', 'left'), wire('csv-right', 'table', 'csv-join', 'right'),
    wire('csv-join', 'table', 'csv-filter', 'table'), wire('csv-filter', 'table', 'csv-cell', 'table'),
    wire('csv-cell', 'text', 'csv-text', 'text'), wire('csv-text', 'frame', 'csv-display', 'source'),
    wire('csv-filter', 'table', 'csv-export', 'table'), wire('csv-export', 'text', 'csv-inspect', 'text'),
    wire('csv-filter', 'table', 'csv-inspect', 'table'),
  ]),
  'network-data-lab': () => graph([
    node('httpFetch', 'net-fetch', 0, 0), node('dataSocket', 'net-socket', 0, 470), node('serverEvents', 'net-events', 0, 1100),
    node('dataInspect', 'net-fetch-inspect', 340, 0), node('dataInspect', 'net-socket-inspect', 340, 470), node('dataInspect', 'net-events-inspect', 340, 1100),
    node('textSource', 'net-caption', 680, 0, { text: 'Network Data Lab' }), node('text', 'net-text', 1020, 0), node('display', 'net-display', 1360, 0),
  ], [
    wire('net-fetch', 'text', 'net-fetch-inspect', 'text'), wire('net-socket', 'text', 'net-socket-inspect', 'text'), wire('net-events', 'text', 'net-events-inspect', 'text'),
    wire('net-caption', 'text', 'net-text', 'text'), wire('net-text', 'frame', 'net-display', 'source'),
  ]),
  'storage-text-lab': () => graph([
    node('textSource', 'store-source', 0, 0, { text: 'A saved signal' }), node('dataStorage', 'store-data', 340, 0, { key: 'teaching-text' }),
    node('dataInspect', 'store-inspect', 680, 0), node('text', 'store-text', 680, 600), node('display', 'store-display', 1020, 600),
  ], [wire('store-source', 'text', 'store-data', 'text'), wire('store-data', 'text', 'store-inspect', 'text'), wire('store-source', 'text', 'store-text', 'text'), wire('store-text', 'frame', 'store-display', 'source')]),
};