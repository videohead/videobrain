#!/usr/bin/env node
/**
 * Validates a GraphDocument with the production compiler.
 *
 * Reads a GraphDocument as JSON on stdin and writes the `inspectGraph` result
 * as JSON on stdout. This exists so the MCP server can report real compiler
 * issues instead of approximating the rules in Python, which would be a second
 * graph model.
 *
 * Usage: echo '<graph json>' | node scripts/inspect-graph.mjs
 */
import { build } from 'vite';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(import.meta.dirname, '..');

const ENTRY_SOURCE = `
export { inspectGraph } from '/src/graph/protocol';
export { parseGraphDocument } from '/src/graph/model';
`;

async function loadGraphModule() {
  const cacheRoot = join(REPO_ROOT, 'node_modules', '.cache');
  await mkdir(cacheRoot, { recursive: true });
  const workDir = await mkdtemp(join(cacheRoot, 'videobrain-inspect-'));
  const entryPath = join(workDir, 'entry.mjs');
  await writeFile(entryPath, ENTRY_SOURCE, 'utf8');
  const result = await build({
    configFile: false,
    resolve: { alias: { '/src': join(REPO_ROOT, 'src') } },
    logLevel: 'error',
    build: {
      write: true,
      minify: false,
      outDir: workDir,
      emptyOutDir: false,
      ssr: true,
      lib: { entry: entryPath, formats: ['es'], fileName: 'bundle' },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  const chunk = output?.output?.find((entry) => entry.type === 'chunk' && entry.isEntry);
  if (!chunk) {
    throw new Error('Inspection bundle produced no entry chunk.');
  }
  const module = await import(pathToFileURL(join(workDir, chunk.fileName)).href);
  return { module, cleanup: () => rm(workDir, { recursive: true, force: true }) };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const text = await readStdin();
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    process.stdout.write(
      JSON.stringify({ ok: false, issues: [{ message: `Graph payload is not valid JSON: ${error}` }] }),
    );
    return;
  }

  const { module, cleanup } = await loadGraphModule();
  try {
    // parseGraphDocument enforces the schema; inspectGraph reports compiler
    // issues, execution order and resource use.
    let parsed;
    try {
      parsed = module.parseGraphDocument(document);
    } catch (error) {
      process.stdout.write(
        JSON.stringify({
          ok: false,
          stage: 'parse',
          issues: [{ message: error instanceof Error ? error.message : String(error) }],
        }),
      );
      return;
    }
    const inspection = module.inspectGraph(parsed);
    process.stdout.write(JSON.stringify({ stage: 'inspect', ...inspection }));
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      issues: [{ message: error instanceof Error ? error.message : String(error) }],
    }),
  );
  process.exitCode = 1;
});
