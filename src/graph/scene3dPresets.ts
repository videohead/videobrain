import { createGraphNode } from './model';
import { GRAPH_SCHEMA_VERSION, type GraphDocument, type GraphEdge } from './types';

const wire = (source: string, sourcePort: string, target: string, targetPort: string): GraphEdge => ({ id: `${source}-${sourcePort}-${target}-${targetPort}`, source: { nodeId: source, portId: sourcePort }, target: { nodeId: target, portId: targetPort } });

export const SCENE_3D_PRESETS = [
  { id: 'primitive-3d-lab', title: '3D Primitive Lab', description: 'Light and texture a rotating 3D primitive, then process its transparent frame.' },
  { id: 'vector-grid-lab', title: 'Vector & Grid Lab', description: 'Compose and split explicit vectors to position a bounded 3D point grid or line.' },
  { id: 'local-glb-stage', title: 'Local GLB Stage', description: 'Import a local GLB/glTF model with the Asset 3D node and light it in a scene.' },
  { id: 'instance-glb-stage', title: 'Instance GLB Stage', description: 'Duplicate an imported model into a bounded GPU instance batch in a grid or ring.' },
] as const;

export const SCENE_3D_PRESET_FACTORIES = {
  'primitive-3d-lab': (): GraphDocument => ({ schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('primitive3d', { x: 0, y: 0 }, { shape: 'sphere', detail: 24 }, 'mesh'),
      createGraphNode('transform3d', { x: 370, y: 0 }, {}, 'transform'),
      createGraphNode('oscillator', { x: 0, y: 700 }, { frequency: 0.07 }, 'motion'),
      createGraphNode('mapRange', { x: 370, y: 1250 }, { outMin: -90, outMax: 90 }, 'rotation'),
      createGraphNode('material3d', { x: 740, y: 0 }, { red: 1, green: 1, blue: 1, metalness: 0, roughness: 0.55 }, 'material'),
      createGraphNode('camera3d', { x: 1110, y: 0 }, { x: 1.8, y: 1.2, z: 2.6 }, 'camera'),
      createGraphNode('light3d', { x: 740, y: 900 }, {}, 'light'),
      createGraphNode('light3d', { x: 1110, y: 1050 }, { mode: 'ambient', intensity: 0.6 }, 'ambient'),
      createGraphNode('gradient', { x: 0, y: 1250 }, { angle: 30 }, 'texture'),
      createGraphNode('render3d', { x: 1480, y: 0 }, {}, 'render'),
      createGraphNode('colorGrade', { x: 1850, y: 0 }, { exposure: 0, saturation: 1, contrast: 1 }, 'grade'),
      createGraphNode('display', { x: 2220, y: 0 }, {}, 'output'),
    ],
    edges: [wire('mesh', 'geometry', 'transform', 'geometry'), wire('motion', 'value', 'rotation', 'value'), wire('rotation', 'value', 'transform', 'rotationY'), wire('transform', 'geometry', 'render', 'geometry'), wire('material', 'material', 'render', 'material'), wire('camera', 'camera', 'render', 'camera'), wire('light', 'light', 'render', 'light'), wire('ambient', 'light', 'render', 'light2'), wire('texture', 'frame', 'render', 'texture'), wire('render', 'frame', 'grade', 'source'), wire('grade', 'frame', 'output', 'source')],
  }),
  'vector-grid-lab': (): GraphDocument => ({ schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('vector2', { x: 0, y: 0 }, { x: 0.2, y: -0.1 }, 'vec2'),
      createGraphNode('splitVector2', { x: 320, y: 0 }, {}, 'split2'),
      createGraphNode('vector3', { x: 640, y: 0 }, {}, 'vec3'),
      createGraphNode('splitVector3', { x: 960, y: 750 }, {}, 'split3'),
      createGraphNode('vector4', { x: 0, y: 480 }, { x: 0.3, y: 0.8, z: 0.7, w: 1 }, 'vec4'),
      createGraphNode('splitVector4', { x: 320, y: 480 }, {}, 'split4'),
      createGraphNode('grid3d', { x: 640, y: 550 }, {}, 'grid'),
      createGraphNode('transform3d', { x: 960, y: -450 }, {}, 'transform'),
      createGraphNode('material3d', { x: 1280, y: 550 }, {}, 'material'),
      createGraphNode('render3d', { x: 1600, y: 0 }, {}, 'render'),
      createGraphNode('display', { x: 1920, y: 0 }, {}, 'output'),
    ],
    edges: [wire('vec2', 'vector', 'split2', 'vector'), wire('split2', 'x', 'vec3', 'x'), wire('split2', 'y', 'vec3', 'y'), wire('vec3', 'vector', 'transform', 'position'), wire('vec3', 'vector', 'split3', 'vector'), wire('split3', 'z', 'transform', 'rotationZ'), wire('vec4', 'vector', 'split4', 'vector'), wire('split4', 'x', 'material', 'red'), wire('split4', 'y', 'material', 'green'), wire('split4', 'z', 'material', 'blue'), wire('split4', 'w', 'material', 'opacity'), wire('grid', 'points', 'transform', 'points'), wire('transform', 'points', 'render', 'points'), wire('material', 'material', 'render', 'material'), wire('render', 'frame', 'output', 'source')],
  }),
  'local-glb-stage': (): GraphDocument => ({ schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('asset3d', { x: 0, y: 0 }, { scaleX: 1, scaleY: 1, scaleZ: 1 }, 'asset'),
      createGraphNode('camera3d', { x: 370, y: 450 }, { x: 2.5, y: 1.8, z: 3 }, 'camera'),
      createGraphNode('light3d', { x: 370, y: 850 }, {}, 'light'),
      createGraphNode('light3d', { x: 740, y: 950 }, { mode: 'ambient', intensity: 0.6 }, 'ambient'),
      createGraphNode('render3d', { x: 740, y: 0 }, {}, 'render'),
      createGraphNode('display', { x: 1110, y: 0 }, {}, 'output'),
    ],
    edges: [wire('asset', 'assetScene', 'render', 'assetScene'), wire('camera', 'camera', 'render', 'camera'), wire('light', 'light', 'render', 'light'), wire('ambient', 'light', 'render', 'light2'), wire('render', 'frame', 'output', 'source')],
  }),
  'instance-glb-stage': (): GraphDocument => ({ schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [
      createGraphNode('asset3d', { x: 0, y: 0 }, { scaleX: 1, scaleY: 1, scaleZ: 1 }, 'asset'),
      createGraphNode('instance3d', { x: 370, y: 0 }, { count: 6, spacing: 1.5 }, 'instances'),
      createGraphNode('camera3d', { x: 740, y: 450 }, { x: 3.5, y: 2.2, z: 4.5 }, 'camera'),
      createGraphNode('light3d', { x: 740, y: 850 }, {}, 'light'),
      createGraphNode('light3d', { x: 1110, y: 950 }, { mode: 'ambient', intensity: 0.6 }, 'ambient'),
      createGraphNode('render3d', { x: 1110, y: 0 }, {}, 'render'),
      createGraphNode('display', { x: 1480, y: 0 }, {}, 'output'),
    ],
    edges: [wire('asset', 'assetScene', 'instances', 'assetScene'), wire('instances', 'assetScene', 'render', 'assetScene'), wire('camera', 'camera', 'render', 'camera'), wire('light', 'light', 'render', 'light'), wire('ambient', 'light', 'render', 'light2'), wire('render', 'frame', 'output', 'source')],
  }),
};