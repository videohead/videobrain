import type { OperatorDefinition, OperatorParamDefinition, PortDefinition } from './types';

const text = (label: string, defaultValue = '', maxLength = 32768): OperatorParamDefinition => ({ type: 'text', label, defaultValue, maxLength, multiline: true });
const number = (label: string, defaultValue: number, min: number, max: number): OperatorParamDefinition => ({ type: 'number', label, defaultValue, min, max, step: 1 });
const select = (label: string, defaultValue: string, options: string[]): OperatorParamDefinition => ({ type: 'select', label, defaultValue, options: options.map((value) => ({ value, label: value })) });
const port = (id: string, type: PortDefinition['type'], label = id): PortDefinition => ({ id, label, type, optional: true });
const output = (id: string, type: PortDefinition['type']): PortDefinition => ({ id, label: id, type });
const status = [output('valid', 'control.f32'), output('error', 'text.utf8')];
const node = (kind: OperatorDefinition['kind'], title: string, summary: string, inputs: PortDefinition[], outputs: PortDefinition[], params: Record<string, OperatorParamDefinition>): OperatorDefinition => ({ kind, title, summary, category: 'data-text', domain: 'control', inputs, outputs: [...outputs, ...status], params });
const textIn = port('text', 'text.utf8');
const jsonIn = port('json', 'data.json');
const tableIn = port('table', 'data.table');
const textOut = output('text', 'text.utf8');
const tableOut = output('table', 'data.table');
const jsonOut = output('json', 'data.json');
const delimiter = select('Delimiter', 'comma', ['comma', 'tab', 'semicolon']);

export const DATA_DEFINITIONS: readonly OperatorDefinition[] = [
  node('textSource', 'Text Source', 'A bounded reusable text literal, committed with Apply.', [], [textOut], { text: text('Text', 'Hello, VideoBrain') }),
  node('textFormat', 'Text Format', 'Join, literal replace, or format a template using {text}, {other}, and {value}.', [textIn, port('other', 'text.utf8'), port('value', 'control.f32')], [textOut], { operation: select('Operation', 'template', ['template', 'join', 'replace']), text: text('Text'), other: text('Other'), template: text('Template', '{text} {value}'), separator: text('Separator', ' ', 128), find: text('Find', '', 256), replacement: text('Replacement', '', 1024), value: number('Value', 0, -1000000000, 1000000000), digits: number('Decimals', 2, 0, 6) }),
  node('numberToText', 'Number to Text', 'Explicit decimal formatting of a scalar control.', [port('value', 'control.f32')], [textOut], { value: number('Value', 0, -1000000000, 1000000000), digits: number('Decimals', 2, 0, 6) }),
  node('textToNumber', 'Text to Number', 'Strict decimal parsing to a finite control; errors return the saved fallback.', [textIn], [output('value', 'control.f32')], { text: text('Text', '0'), fallback: number('Fallback', 0, -1000000000, 1000000000) }),
  node('jsonParse', 'JSON Parse', 'Parse bounded text into immutable JSON; malformed input returns null and an error.', [textIn], [jsonOut], { text: text('JSON', '{"title":"VideoBrain","amount":0.5}') }),
  node('jsonSelect', 'JSON Select', 'Select an own property or array item using JSON Pointer, such as /items/0/name.', [jsonIn], [jsonOut], { pointer: text('JSON Pointer', '/title', 1024) }),
  node('jsonStringify', 'JSON to Text', 'Serialize JSON, or emit a selected string without quotes.', [jsonIn], [textOut], { mode: select('Mode', 'string', ['string', 'compact', 'pretty']) }),
  node('csvParse', 'CSV Parse', 'Parse quoted CSV into a bounded string table; supports editable literal data.', [textIn], [tableOut], { text: text('CSV', 'name,value\nAlpha,0.25\nBeta,0.75'), header: select('Header', 'yes', ['yes', 'no']), delimiter }),
  node('csvStringify', 'Table to CSV', 'Serialize a table as CSV with spreadsheet formula escaping.', [tableIn], [textOut], { delimiter }),
  node('tableTransform', 'Table Transform', 'Filter by literal substring, select a column, or stable-sort strings.', [tableIn], [tableOut], { operation: select('Operation', 'filter', ['filter', 'select', 'sort']), column: text('Column', 'name', 256), match: text('Contains', '', 1024), direction: select('Direction', 'ascending', ['ascending', 'descending']) }),
  node('tableSelect', 'Table Cell', 'Read one table cell as text for explicit numeric conversion or text rendering.', [tableIn, port('row', 'control.f32')], [textOut], { column: text('Column', 'value', 256), row: number('Row (zero based)', 0, 0, 255) }),
  node('tableJoin', 'Table Join', 'Bounded inner equijoin with left/right-prefixed column names; duplicate keys retain all matches.', [port('left', 'data.table'), port('right', 'data.table')], [tableOut], { leftKey: text('Left key', 'id', 256), rightKey: text('Right key', 'id', 256) }),
  node('httpFetch', 'Fetch', 'Explicit credential-free HTTP GET with CORS, timeout, cancellation, and bounded text response.', [], [textOut, output('status', 'control.f32')], { url: text('URL', '', 2048) }),
  node('dataSocket', 'WebSocket', 'Explicit text connection and send, latest bounded message, and manual reconnect.', [textIn], [textOut, output('status', 'control.f32')], { url: text('URL', '', 2048), text: text('Send text') }),
  node('serverEvents', 'Server Events', 'Explicit EventSource connection receiving default message events as bounded text.', [], [textOut, output('status', 'control.f32')], { url: text('URL', '', 2048) }),
  node('dataStorage', 'Storage', 'Explicit read/write/delete of browser-local namespaced text; never writes automatically.', [textIn], [textOut, output('status', 'control.f32')], { key: text('Key', 'example', 64), text: text('Write text') }),
  node('dataInspect', 'Inspect', 'Data demand root showing a bounded latest-value snapshot, not an unbounded log.', [textIn, jsonIn, tableIn, port('value', 'control.f32')], [], {}),
];

export const DATA_NODE_KINDS = DATA_DEFINITIONS.map(({ kind }) => kind);