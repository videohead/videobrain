import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { getOperatorCatalog, OPERATOR_CATALOG_VERSION } from './protocol';
import { GRAPH_SCHEMA_VERSION } from './types';

/**
 * Drift guard for the MCP authoring knowledge pack.
 *
 * `mcp/graph-knowledge.json` is generated from this registry by
 * `scripts/export-graph-knowledge.mjs` and served to agents by the MCP
 * server. If an operator is added or changed without regenerating it, agents
 * author against a stale schema and produce graphs that do not compile.
 *
 * Regenerate with: npm run build:mcp-knowledge
 */
const PACK_PATH = resolve(import.meta.dirname, '../../mcp/graph-knowledge.json');

interface KnowledgePack {
  catalogVersion: number;
  graphSchemaVersion: number;
  operators: { kind: string }[];
  examples: { id: string; compiles: boolean }[];
  coverage: { kindsWithoutExample: string[] };
  presetFailures: { id: string }[];
}

const pack = (): KnowledgePack =>
  JSON.parse(readFileSync(PACK_PATH, 'utf8')) as KnowledgePack;

describe('MCP knowledge pack', () => {
  it('exists, so the MCP server can serve authoring data', () => {
    expect(
      existsSync(PACK_PATH),
      'Run: npm run build:mcp-knowledge',
    ).toBe(true);
  });

  it('matches the current catalog and schema versions', () => {
    const current = pack();
    expect(
      current.catalogVersion,
      'Catalog changed. Run: npm run build:mcp-knowledge',
    ).toBe(OPERATOR_CATALOG_VERSION);
    expect(current.graphSchemaVersion).toBe(GRAPH_SCHEMA_VERSION);
  });

  it('covers every registered node kind', () => {
    const current = pack();
    const registered = getOperatorCatalog().operators.map(({ kind }) => kind);
    const packed = current.operators.map(({ kind }) => kind);
    expect(
      packed.slice().sort(),
      'Operator set changed. Run: npm run build:mcp-knowledge',
    ).toEqual(registered.slice().sort());
  });

  it('ships only worked examples that compile', () => {
    const current = pack();
    expect(current.examples.filter((entry) => !entry.compiles)).toEqual([]);
    expect(current.presetFailures).toEqual([]);
  });

  it('gives every node kind at least one worked example', () => {
    // An agent that cannot see a node used correctly is likely to misuse it.
    expect(pack().coverage.kindsWithoutExample).toEqual([]);
  });
});
