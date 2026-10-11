import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { boundedText, csvText, joinTables, jsonText, parseCsv, parseJson, selectJson, textNumber, transformTable } from './data';

describe('bounded structured data', () => {
  const fixture = (name: string) => readFileSync(resolve('public/test-data', name), 'utf8');

  it('selects documented values from the shared JSON fixture', () => {
    const value = parseJson(fixture('controls.json'));
    expect(selectJson(value, '/patches/1/title')).toBe('Main Scene');
    expect(selectJson(value, '/labels/stage~1name')).toBe('Main / Left');
    expect(selectJson(value, '/labels/~0cue')).toBe('Opening');
    expect(selectJson(value, '/optional')).toBeNull();
    expect(selectJson(value, '/channels/4')).toBe(1);
  });

  it('joins shared cue tables and preserves quoted data and duplicate matches', () => {
    const cues = parseCsv(fixture('cues.csv'));
    const parameters = parseCsv(fixture('parameters.csv'));
    expect(cues.rows).toHaveLength(4);
    expect(cues.rows[1]?.[3]).toBe('Say "hello"');
    expect(cues.rows[2]?.[3]).toBe('Line one\nLine two');
    const joined = joinTables(cues, parameters, 'id', 'id');
    expect(joined.rows).toHaveLength(4);
    const main = transformTable(joined, 'filter', 'left.id', 'main');
    expect(transformTable(main, 'select', 'right.mix', '').rows).toEqual([['0.75'], ['1']]);
    const exported = parseCsv(csvText(joined));
    expect(exported.columns).toEqual(joined.columns);
    expect(exported.rows.slice(0, 3)).toEqual(joined.rows.slice(0, 3));
    expect(exported.rows[3]?.[6]).toBe("'-0.1");
  });

  it('checks the shared malformed-input and numeric fixture expectations', () => {
    const cases = JSON.parse(fixture('parser-cases.json')) as {
      json: { name: string; input: string; valid: boolean }[];
      csv: { name: string; input: string; valid: boolean }[];
      numbers: { input: string; expected: number | null }[];
    };
    for (const group of ['json', 'csv'] as const) for (const entry of cases[group]) {
      const parse = () => group === 'json' ? parseJson(entry.input) : parseCsv(entry.input);
      if (entry.valid) expect(parse, entry.name).not.toThrow();
      else expect(parse, entry.name).toThrow();
    }
    for (const entry of cases.numbers) {
      if (entry.expected === null) expect(() => textNumber(entry.input)).toThrow();
      else expect(textNumber(entry.input)).toBe(entry.expected);
    }
  });

  it('parses each shared stream message independently', () => {
    const envelope = parseJson(fixture('stream-messages.json'));
    const messages = selectJson(envelope, '/messages');
    expect(Array.isArray(messages)).toBe(true);
    if (!Array.isArray(messages)) throw new Error('Missing stream messages');
    expect(messages).toHaveLength(5);
    for (const [index, message] of messages.entries()) {
      const parsed = parseJson(jsonText(message as Parameters<typeof jsonText>[0]));
      expect(selectJson(parsed, '/sequence')).toBe(index);
      expect(selectJson(parsed, '/timestampMs')).toBe(index * 250);
    }
  });

  it('accepts exact data limits and rejects the next value', () => {
    expect(boundedText('x'.repeat(32768))).toHaveLength(32768);
    expect(() => boundedText('x'.repeat(32769))).toThrow();
    const columns = Array.from({ length: 16 }, (_, index) => `column${index}`);
    const row = Array(16).fill('0').join(',');
    const csv = [columns.join(','), ...Array.from({ length: 256 }, () => row)].join('\n');
    expect(parseCsv(csv).rows).toHaveLength(256);
    expect(() => parseCsv(`${csv}\n${row}`)).toThrow();
    expect(() => parseCsv(Array.from({ length: 33 }, (_, index) => `column${index}`).join(','))).toThrow();
    expect(parseJson(JSON.stringify(Array(4095).fill(0)))).toHaveLength(4095);
    expect(() => parseJson(JSON.stringify(Array(4096).fill(0)))).toThrow();
  });
  it('parses immutable JSON and selects own properties with JSON Pointer', () => {
    const value = parseJson('{"a/b":[{"~name":42}],"__proto__":{"safe":true}}');
    expect(selectJson(value, '/a~1b/0/~0name')).toBe(42);
    expect(selectJson(value, '/__proto__/safe')).toBe(true);
    expect(() => selectJson(value, '/toString')).toThrow();
    expect(() => selectJson(value, '/a~2b')).toThrow();
    expect(Object.isFrozen(value)).toBe(true);
    expect(jsonText(parseJson('null'))).toBe('null');
  });
  it('rejects malformed, deep, large, or nonfinite data', () => {
    expect(() => parseJson('{')).toThrow();
    expect(() => parseJson('1e999')).toThrow();
    expect(() => parseJson('['.repeat(18) + '0' + ']'.repeat(18))).toThrow();
    expect(() => boundedText('é'.repeat(20000))).toThrow();
    expect(() => parseJson(JSON.stringify(Array(4097).fill(0)))).toThrow();
  });
  it('handles CSV quotes/newlines and rejects ambiguous headers and ragged rows', () => {
    const value = parseCsv('name,note\r\nAda,"hello,\nworld"\r\nBob,"a""b"');
    expect(value.rows).toEqual([['Ada', 'hello,\nworld'], ['Bob', 'a"b']]);
    expect(parseCsv(csvText(value))).toEqual(value);
    expect(() => parseCsv('a,a\n1,2')).toThrow();
    expect(() => parseCsv('a,b\n1')).toThrow();
    expect(csvText(parseCsv('a\n=1+1'))).toContain("'=1+1");
  });
  it('filters, selects, stably sorts, and bounds joins', () => {
    const value = parseCsv('id,name\n2,Bob\n1,Ada');
    expect(transformTable(value, 'sort', 'id', '').rows[0]).toEqual(['1', 'Ada']);
    expect(transformTable(value, 'filter', 'name', 'Ad').rows).toHaveLength(1);
    expect(transformTable(value, 'select', 'name', '').columns).toEqual(['name']);
    expect(joinTables(value, parseCsv('id,color\n1,red'), 'id', 'id').rows).toEqual([['1', 'Ada', '1', 'red']]);
    expect(() => transformTable(value, 'select', 'missing', '')).toThrow();
  });
  it('converts explicit decimal text without hidden coercion', () => {
    expect(textNumber(' -1.25e2 ')).toBe(-125);
    for (const value of ['', '0xff', 'Infinity', '12px', '1e10']) expect(() => textNumber(value)).toThrow();
  });
});