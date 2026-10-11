import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const artifactDirectory = path.resolve(
  repositoryRoot,
  process.argv[2] ?? 'dist/storybook',
);
const requiredFiles = ['index.html', 'iframe.html', 'index.json'];
const requiredStories = [
  'foundations-visual-language--colors',
  'controls-inline-node-parameters--numeric-sliders',
  'controls-inline-node-parameters--mixed-parameters',
  'nodes-operator-node--all-node-kinds',
  'nodes-operator-node--shape-generators',
  'nodes-operator-node--gradient-generator',
  'nodes-operator-node--text-and-noise-generators',
  'panels-studio-panels--numeric-inspector',
  'workspace-graph-editor--running-patch',
  'workspace-graph-editor--shape-studio',
  'workspace-graph-editor--gradient-lab',
  'workspace-graph-editor--poster-maker',
  'workspace-graph-editor--noise-lab',
  'workspace-graph-editor--shader-lab',
  'nodes-operator-node--shader-source',
  'nodes-operator-node--levels',
  'nodes-operator-node--hsvhsl',
  'nodes-operator-node--luma-key',
  'nodes-operator-node--chroma-key',
  'nodes-operator-node--crossfade',
  'nodes-operator-node--displace',
  'nodes-operator-node--edge',
  'nodes-operator-node--pixelate',
  'nodes-operator-node--tile-kaleidoscope',
  'nodes-operator-node--channel-shuffle',
  'workspace-graph-editor--color-channel-lab',
  'workspace-graph-editor--keyed-camera',
  'workspace-graph-editor--displacement-map-lab',
  'workspace-graph-editor--pattern-mix-lab',
];

for (const file of requiredFiles) {
  const details = await stat(path.join(artifactDirectory, file));
  if (!details.isFile()) {
    throw new Error(`Storybook artifact is missing ${file}`);
  }
}

const index = JSON.parse(
  await readFile(path.join(artifactDirectory, 'index.json'), 'utf8'),
);
const entries = Object.values(index.entries ?? {});
if (entries.length === 0) {
  throw new Error('Storybook index.json contains no catalog entries');
}

for (const id of requiredStories) {
  if (!entries.some((entry) => entry.id === id)) {
    throw new Error(`Storybook artifact is missing required story ${id}`);
  }
}

console.log(
  `Verified Storybook artifact: ${entries.length} entries in ${artifactDirectory}`,
);
