import Papa from 'papaparse';

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export interface DataTable { readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] }
export const MAX_DATA_TEXT = 32768;
export const MAX_DATA_ITEMS = 4096;
export const EMPTY_TABLE: DataTable = Object.freeze({ columns: Object.freeze([]), rows: Object.freeze([]) });

export function boundedText(text: string): string {
  if (text.length > MAX_DATA_TEXT || new TextEncoder().encode(text).byteLength > MAX_DATA_TEXT) throw new Error('Data exceeds 32 KiB.');
  return text;
}

export function parseJson(text: string): JsonValue {
  const parsed: unknown = JSON.parse(boundedText(text));
  let count = 0;
  const visit = (value: unknown, depth: number): JsonValue => {
    if (++count > MAX_DATA_ITEMS || depth > 16) throw new Error('JSON exceeds 4096 values or 16 levels.');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return Object.freeze(value.map((item: unknown) => visit(item, depth + 1)));
    if (typeof value === 'object' && value !== null) {
      const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
      for (const [key, child] of Object.entries(value)) result[key] = visit(child, depth + 1);
      return Object.freeze(result);
    }
    throw new Error('Invalid JSON value.');
  };
  return visit(parsed, 0);
}

export function selectJson(value: JsonValue, pointer: string): JsonValue {
  if (!pointer) return value;
  if (!pointer.startsWith('/') || pointer.length > 1024) throw new Error('Use a JSON Pointer such as /items/0/name.');
  let selected = value;
  for (const segment of pointer.slice(1).split('/')) {
    if (/~(?:[^01]|$)/.test(segment)) throw new Error('Invalid JSON Pointer escape.');
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (selected === null || typeof selected !== 'object' || !Object.hasOwn(selected, key)) throw new Error('JSON Pointer was not found.');
    if (Array.isArray(selected) && !/^(0|[1-9][0-9]*)$/.test(key)) throw new Error('Invalid array index.');
    selected = (selected as Record<string, JsonValue>)[key] ?? null;
  }
  return selected;
}

export function jsonText(value: JsonValue, pretty = false): string {
  return boundedText(JSON.stringify(value, null, pretty ? 2 : undefined));
}

export function table(columns: readonly string[], rows: readonly (readonly string[])[]): DataTable {
  if (columns.length > 32 || rows.length > 256 || rows.length * columns.length > MAX_DATA_ITEMS) throw new Error('Table exceeds 32 columns, 256 rows, or 4096 cells.');
  if (new Set(columns).size !== columns.length || columns.some((column) => !column)) throw new Error('Column names must be unique and nonempty.');
  if (rows.some((row) => row.length !== columns.length)) throw new Error('Table rows must match the column count.');
  boundedText(JSON.stringify({ columns, rows }));
  return Object.freeze({ columns: Object.freeze([...columns]), rows: Object.freeze(rows.map((row) => Object.freeze([...row]))) });
}

export function parseCsv(text: string, header = true, delimiter = ','): DataTable {
  if (!text) return EMPTY_TABLE;
  const parsed = Papa.parse<string[]>(boundedText(text), { delimiter, skipEmptyLines: 'greedy', preview: 258 });
  if (parsed.errors.length) throw new Error(parsed.errors[0]?.message ?? 'Invalid CSV.');
  const first = parsed.data[0];
  if (!first) return EMPTY_TABLE;
  const columns = header ? first : first.map((_, index) => `column${index + 1}`);
  return table(columns, header ? parsed.data.slice(1) : parsed.data);
}

export function csvText(value: DataTable, delimiter = ','): string {
  return boundedText(Papa.unparse({ fields: [...value.columns], data: value.rows.map((row) => [...row]) }, { delimiter, escapeFormulae: true }));
}

export function tableColumn(value: DataTable, name: string): number {
  const index = value.columns.indexOf(name);
  if (index < 0) throw new Error(`Unknown column: ${name}`);
  return index;
}

export function transformTable(value: DataTable, operation: string, column: string, match: string, descending = false): DataTable {
  const index = tableColumn(value, column);
  if (operation === 'select') return table([column], value.rows.map((row) => [row[index] ?? '']));
  if (operation === 'filter') return table(value.columns, value.rows.filter((row) => (row[index] ?? '').includes(match)));
  const rows = [...value.rows].sort((left, right) => {
    const first = left[index] ?? '';
    const second = right[index] ?? '';
    const result = first < second ? -1 : first > second ? 1 : 0;
    return descending ? -result : result;
  });
  return table(value.columns, rows);
}

export function joinTables(left: DataTable, right: DataTable, leftKey: string, rightKey: string): DataTable {
  const leftIndex = tableColumn(left, leftKey);
  const rightIndex = tableColumn(right, rightKey);
  const columns = [...left.columns.map((column) => `left.${column}`), ...right.columns.map((column) => `right.${column}`)];
  const rows: string[][] = [];
  for (const leftRow of left.rows) for (const rightRow of right.rows) {
    if (leftRow[leftIndex] !== rightRow[rightIndex]) continue;
    if (rows.length >= 256 || (rows.length + 1) * columns.length > MAX_DATA_ITEMS) throw new Error('Joined table exceeds the row/cell budget.');
    rows.push([...leftRow, ...rightRow]);
  }
  return table(columns, rows);
}

export function textNumber(text: string): number {
  const trimmed = text.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) throw new Error('Expected a decimal number.');
  const value = Number(trimmed);
  if (!Number.isFinite(value) || Math.abs(value) > 1e9) throw new Error('Number exceeds the finite +/-1e9 range.');
  return value;
}