#!/usr/bin/env node
/**
 * Exports a machine-readable authoring knowledge pack for the VideoBrain MCP
 * server.
 *
 * Everything here is derived from the production registry, compiler, and
 * preset factories. Nothing is hand-maintained, so the pack cannot drift into
 * being a second graph model: if an operator changes, the pack changes with it.
 *
 * Usage: node scripts/export-graph-knowledge.mjs [outputPath]
 */
import { build } from 'vite';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const DEFAULT_OUTPUT = join(REPO_ROOT, 'mcp', 'graph-knowledge.json');

/** Entry that re-exports exactly what the pack needs from the real modules. */
const ENTRY_SOURCE = `
export { getOperatorCatalog, inspectGraph } from '/src/graph/protocol';
export { GRAPH_PRESETS, createGraphPreset } from '/src/graph/presets';
export { validateConnection } from '/src/graph/compiler';
`;

/** Bundles the graph modules for Node and imports the result. */
async function loadGraphModule() {
  // The bundle must live inside the repository: an SSR build leaves real
  // dependencies external, so Node resolves them from the repo node_modules.
  const cacheRoot = join(REPO_ROOT, 'node_modules', '.cache');
  await mkdir(cacheRoot, { recursive: true });
  const workDir = await mkdtemp(join(cacheRoot, 'videobrain-knowledge-'));
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
  // Vite's emitted filename varies by version, so take it from the result
  // rather than assuming one.
  const output = Array.isArray(result) ? result[0] : result;
  const chunk = output?.output?.find(
    (entry) => entry.type === 'chunk' && entry.isEntry,
  );
  if (!chunk) {
    throw new Error('Knowledge bundle produced no entry chunk.');
  }
  const module = await import(pathToFileURL(join(workDir, chunk.fileName)).href);
  return { module, cleanup: () => rm(workDir, { recursive: true, force: true }) };
}

/**
 * Port types that can legally feed a target port type. Derived by asking the
 * production connection validator rather than restating its rules.
 */
function portCompatibility(catalog, validateConnection) {
  // One representative producer/consumer per port type, taken from the catalog.
  const producerOf = new Map();
  const consumerOf = new Map();
  for (const operator of catalog.operators) {
    for (const output of operator.outputs) {
      if (!producerOf.has(output.type)) {
        producerOf.set(output.type, { operator, port: output });
      }
    }
    for (const input of operator.inputs) {
      if (!consumerOf.has(input.type)) {
        consumerOf.set(input.type, { operator, port: input });
      }
    }
  }

  const compatibility = {};
  for (const [targetType, consumer] of consumerOf) {
    const accepts = [];
    for (const [sourceType, producer] of producerOf) {
      const document = {
        schemaVersion: 1,
        nodes: [
          { id: 'source', kind: producer.operator.kind, position: { x: 0, y: 0 }, params: {} },
          { id: 'target', kind: consumer.operator.kind, position: { x: 400, y: 0 }, params: {} },
        ],
        edges: [],
      };
      const result = validateConnection(
        document,
        { nodeId: 'source', portId: producer.port.id },
        { nodeId: 'target', portId: consumer.port.id },
      );
      if (result.valid) {
        accepts.push(sourceType);
      }
    }
    compatibility[targetType] = accepts.sort();
  }
  return compatibility;
}

/** Compact a preset into a worked example, verified by the real compiler. */
function presetExample(preset, document, inspection) {
  const kinds = [...new Set(document.nodes.map((node) => node.kind))].sort();
  return {
    id: preset.id,
    title: preset.title,
    description: preset.description,
    nodeKinds: kinds,
    nodeCount: document.nodes.length,
    edgeCount: document.edges.length,
    compiles: inspection.ok,
    issues: inspection.issues.map((issue) => issue.message),
    displayNodeIds: [...inspection.displayNodeIds],
    visualPasses: inspection.resources.visualPasses,
    // The full document, so an agent can copy a known-good chain verbatim.
    document,
  };
}

async function main() {
  const outputPath = resolve(process.argv[2] ?? DEFAULT_OUTPUT);
  const { module, cleanup } = await loadGraphModule();
  try {
    const catalog = module.getOperatorCatalog();

    const examples = [];
    const failures = [];
    for (const preset of module.GRAPH_PRESETS) {
      let document;
      try {
        document = module.createGraphPreset(preset.id);
      } catch (error) {
        failures.push({ id: preset.id, error: String(error) });
        continue;
      }
      const inspection = module.inspectGraph(document);
      if (!inspection.ok) {
        failures.push({ id: preset.id, error: inspection.issues.map((i) => i.message).join('; ') });
      }
      examples.push(presetExample(preset, document, inspection));
    }

    // Which node kinds already appear in at least one verified example.
    const covered = new Set(examples.flatMap((entry) => entry.nodeKinds));
    const uncovered = catalog.operators
      .map(({ kind }) => kind)
      .filter((kind) => !covered.has(kind))
      .sort();

    const pack = {
      generatedAt: new Date().toISOString(),
      source: 'derived from the production registry, compiler and presets',
      protocolVersion: catalog.protocolVersion,
      graphSchemaVersion: catalog.graphSchemaVersion,
      catalogVersion: catalog.catalogVersion,
      portTypes: catalog.portTypes,
      categories: catalog.categories,
      limits: catalog.limits,
      portCompatibility: portCompatibility(catalog, module.validateConnection),
      operators: catalog.operators,
      examples,
      coverage: {
        operatorCount: catalog.operators.length,
        exampleCount: examples.length,
        kindsWithoutExample: uncovered,
      },
      presetFailures: failures,
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
    process.stdout.write(
      `Wrote ${outputPath}: catalog ${pack.catalogVersion}, ` +
        `${pack.operators.length} operators, ${examples.length} examples, ` +
        `${uncovered.length} kinds without an example, ` +
        `${failures.length} preset failures\n`,
    );
    if (failures.length > 0) {
      process.stdout.write(`Preset failures: ${failures.map((f) => f.id).join(', ')}\n`);
    }
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
