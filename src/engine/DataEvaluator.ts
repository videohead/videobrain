import type { CompiledNode } from '../graph';
import { DATA_NODE_KINDS } from '../graph/dataOperators';
import { boundedText, csvText, EMPTY_TABLE, joinTables, jsonText, parseCsv, parseJson, selectJson, tableColumn, textNumber, transformTable, type DataTable, type JsonValue } from '../graph/data';
import { dataSessions } from './DataSessions';

export type DataValue = string | number | JsonValue | DataTable;
export type DataOutputs = Record<string, DataValue>;
const kinds = new Set(DATA_NODE_KINDS);
export function isDataNode(kind: CompiledNode['node']['kind']) { return kinds.has(kind); }

export class DataEvaluator {
  private cache = new Map<string, { key: string; outputs: DataOutputs }>();
  clear() { this.cache.clear(); }
  evaluate(compiled: CompiledNode, inputs: Record<string, DataValue>): DataOutputs {
    const { node } = compiled;
    const session = dataSessions.snapshot(node.id);
    const key = JSON.stringify([node.kind, node.params, inputs, session.text, session.status, session.error]);
    const cached = this.cache.get(node.id);
    if (cached?.key === key) return cached.outputs;
    if (this.cache.size > 256) this.cache.clear();
    const params = node.params;
    const text = (id: string) => {
      const value = inputs[id] ?? params[id] ?? '';
      if (typeof value !== 'string') throw new Error('Expected a text input; use an explicit converter.');
      return boundedText(value);
    };
    const numeric = (id: string) => {
      const value = Number(inputs[id] ?? params[id] ?? 0);
      if (!Number.isFinite(value)) throw new Error('Expected a finite control.');
      return Math.max(-1e9, Math.min(1e9, value));
    };
    const json = (inputs.json ?? null) as JsonValue;
    const data = (inputs.table ?? EMPTY_TABLE) as DataTable;
    const delimiter = params.delimiter === 'tab' ? '\t' : params.delimiter === 'semicolon' ? ';' : ',';
    const outputs: DataOutputs = { valid: 1, error: '' };
    try {
      switch (node.kind) {
        case 'textSource': outputs.text = text('text'); break;
        case 'numberToText': outputs.text = numeric('value').toFixed(Number(params.digits)); break;
        case 'textToNumber': outputs.value = textNumber(text('text')); break;
        case 'textFormat': {
          const source = text('text');
          const other = text('other');
          if (params.operation === 'join') outputs.text = boundedText(source + String(params.separator) + other);
          else if (params.operation === 'replace') {
            const find = String(params.find);
            const parts = find ? source.split(find) : [source];
            const replacement = String(params.replacement);
            const size = source.length + (parts.length - 1) * (replacement.length - find.length);
            if (size > 32768) throw new Error('Replacement exceeds 32 KiB.');
            outputs.text = boundedText(parts.join(replacement));
          } else outputs.text = boundedText(String(params.template).replace(/\{(text|other|value)\}/g, (_, token: string) => token === 'text' ? source : token === 'other' ? other : numeric('value').toFixed(Number(params.digits))));
          break;
        }
        case 'jsonParse': outputs.json = parseJson(text('text')); break;
        case 'jsonSelect': outputs.json = selectJson(json, String(params.pointer)); break;
        case 'jsonStringify': outputs.text = params.mode === 'string' && typeof json === 'string' ? boundedText(json) : jsonText(json, params.mode === 'pretty'); break;
        case 'csvParse': outputs.table = parseCsv(text('text'), params.header === 'yes', delimiter); break;
        case 'csvStringify': outputs.text = csvText(data, delimiter); break;
        case 'tableTransform': outputs.table = transformTable(data, String(params.operation), String(params.column), String(params.match), params.direction === 'descending'); break;
        case 'tableSelect': {
          const row = data.rows[Math.max(0, Math.min(255, Math.floor(numeric('row'))))];
          if (!row) throw new Error('Table row was not found.');
          outputs.text = row[tableColumn(data, String(params.column))] ?? '';
          break;
        }
        case 'tableJoin': outputs.table = joinTables((inputs.left ?? EMPTY_TABLE) as DataTable, (inputs.right ?? EMPTY_TABLE) as DataTable, String(params.leftKey), String(params.rightKey)); break;
        case 'httpFetch': case 'serverEvents': case 'dataSocket': case 'dataStorage':
          if (node.kind === 'dataSocket' || node.kind === 'dataStorage') dataSessions.input(node.id, text('text'));
          outputs.text = session.text; outputs.status = session.status;
          if (session.error) throw new Error(session.error);
          break;
        case 'dataInspect':
          dataSessions.report(node.id, JSON.stringify(inputs, null, 2));
          break;
      }
    } catch (error) {
      outputs.valid = 0; outputs.error = error instanceof Error ? error.message : 'Data processing failed.';
      for (const port of compiled.definition.outputs) {
        if (port.id === 'valid' || port.id === 'error') continue;
        outputs[port.id] = port.type === 'data.json' ? null : port.type === 'data.table' ? EMPTY_TABLE : port.type === 'text.utf8' ? '' : node.kind === 'textToNumber' ? Number(params.fallback) : 0;
      }
    }
    if (node.kind !== 'dataInspect') dataSessions.report(node.id, '', typeof outputs.error === 'string' ? outputs.error : '');
    this.cache.set(node.id, { key, outputs });
    return outputs;
  }
}