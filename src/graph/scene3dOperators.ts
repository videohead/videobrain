import type { NodeKind, OperatorDefinition, OperatorParamDefinition, PortDefinition, PortType } from './types';

const number = (label: string, defaultValue: number, min: number, max: number, step = 0.01): OperatorParamDefinition => ({ type: 'number', label, defaultValue, min, max, step });
const select = (label: string, defaultValue: string, options: string[]): OperatorParamDefinition => ({ type: 'select', label, defaultValue, options: options.map((value) => ({ value, label: value })) });
const port = (id: string, type: PortType, label = id): PortDefinition => ({ id, type, label, optional: true });
const axes = ['x', 'y', 'z', 'w'] as const;
const vectorParams = (size: number) => Object.fromEntries(axes.slice(0, size).map((axis) => [axis, number(axis.toUpperCase(), 0, -1000, 1000)]));
const color = { red: number('Red', 0.2, 0, 1), green: number('Green', 0.7, 0, 1), blue: number('Blue', 0.55, 0, 1) };
const node = (kind: NodeKind, title: string, summary: string, inputs: PortDefinition[], outputs: PortDefinition[], params: Record<string, OperatorParamDefinition>): OperatorDefinition => ({ kind, title, summary, category: 'scene-3d', domain: 'control', inputs: [...inputs, ...Object.entries(params).filter(([, parameter]) => parameter.type === 'number').map(([id, parameter]) => port(id, 'control.f32', parameter.label))], outputs, params });
const compose = (kind: NodeKind, size: 2 | 3 | 4) => node(kind, `Vector ${size}`, `Compose ${size} scalar controls into an explicit vector.`, [], [port('vector', `control.vec${size}`)], vectorParams(size));
const split = (kind: NodeKind, size: 2 | 3 | 4) => node(kind, `Split Vector ${size}`, `Split a vec${size} into scalar controls; missing input is zero.`, [port('vector', `control.vec${size}`)], axes.slice(0, size).map((axis) => port(axis, 'control.f32')), {});

export const SCENE_3D_DEFINITIONS: readonly OperatorDefinition[] = [
  compose('vector2', 2), compose('vector3', 3), compose('vector4', 4),
  split('splitVector2', 2), split('splitVector3', 3), split('splitVector4', 4),
  node('primitive3d', 'Primitive 3D', 'Bounded box, sphere, plane, or cylinder mesh in right-handed world units.', [], [port('geometry', 'geometry.mesh')], {
    shape: select('Shape', 'box', ['box', 'sphere', 'plane', 'cylinder']),
    width: number('Width', 1, 0.01, 20), height: number('Height', 1, 0.01, 20), depth: number('Depth', 1, 0.01, 20), detail: number('Detail', 8, 3, 24, 1),
  }),
  node('grid3d', 'Grid / Line 3D', 'Bounded XY point grid or X-axis connected line; point size is set by PBR Material.', [], [port('points', 'geometry.points')], {
    mode: select('Mode', 'grid', ['grid', 'line']), width: number('Width', 2, 0.01, 20), height: number('Height', 2, 0.01, 20), countX: number('X count', 16, 2, 64, 1), countY: number('Y count', 16, 2, 64, 1),
  }),
  node('transform3d', 'Transform 3D', 'Compose local pivot/scale/XYZ rotation/translation onto mesh and point descriptors; 16 levels maximum.', [port('geometry', 'geometry.mesh'), port('points', 'geometry.points'), port('position', 'control.vec3'), port('rotationVector', 'control.vec3'), port('scaleVector', 'control.vec3')], [port('geometry', 'geometry.mesh'), port('points', 'geometry.points')], {
    x: number('X', 0, -20, 20), y: number('Y', 0, -20, 20), z: number('Z', 0, -20, 20),
    rotationX: number('Rotate X (deg)', 0, -360, 360, 1), rotationY: number('Rotate Y (deg)', 0, -360, 360, 1), rotationZ: number('Rotate Z (deg)', 0, -360, 360, 1),
    scaleX: number('Scale X', 1, 0.01, 10), scaleY: number('Scale Y', 1, 0.01, 10), scaleZ: number('Scale Z', 1, 0.01, 10),
    pivotX: number('Pivot X', 0, -20, 20), pivotY: number('Pivot Y', 0, -20, 20), pivotZ: number('Pivot Z', 0, -20, 20),
  }),
  node('camera3d', 'Camera 3D', 'Perspective or orthographic camera looking at a world-space target; Y up.', [port('position', 'control.vec3'), port('target', 'control.vec3')], [port('camera', 'scene.camera')], {
    mode: select('Projection', 'perspective', ['perspective', 'orthographic']),
    x: number('X', 3, -50, 50), y: number('Y', 2, -50, 50), z: number('Z', 4, -50, 50),
    targetX: number('Target X', 0, -20, 20), targetY: number('Target Y', 0, -20, 20), targetZ: number('Target Z', 0, -20, 20),
    fov: number('Vertical FOV (deg)', 45, 5, 150, 1), span: number('Ortho height', 4, 0.1, 100), near: number('Near', 0.01, 0.01, 10), far: number('Far', 100, 11, 1000, 1),
  }),
  node('light3d', 'Light 3D', 'Directional, point, or ambient light; Render 3D accepts two explicit light inputs.', [port('position', 'control.vec3'), port('color', 'control.vec3')], [port('light', 'scene.light')], {
    mode: select('Type', 'directional', ['directional', 'point', 'ambient']),
    red: number('Red', 1, 0, 1), green: number('Green', 1, 0, 1), blue: number('Blue', 1, 0, 1),
    intensity: number('Intensity', 3, 0, 20), x: number('X', 3, -50, 50), y: number('Y', 4, -50, 50), z: number('Z', 5, -50, 50),
  }),
  node('material3d', 'PBR Material', 'PBR mesh shading; point/line primitives use unlit base color. Frame texture is patched on Render 3D.', [port('color', 'control.vec3')], [port('material', 'material.pbr')], {
    ...color, metalness: number('Metalness', 0.1, 0, 1), roughness: number('Roughness', 0.45, 0.04, 1), emissive: number('Emissive', 0, 0, 4), opacity: number('Opacity', 1, 0, 1),
    wireframe: select('Wireframe', 'off', ['off', 'on']), pointSize: number('Point size', 0.06, 0.01, 1),
  }),
  {
    kind: 'render3d', title: 'Render 3D', summary: 'Render one mesh and one point/line descriptor with two lights into a transparent frame. Optional frame input supplies the mesh base-color map.',
    category: 'scene-3d', domain: 'frame',
    inputs: [port('geometry', 'geometry.mesh'), port('points', 'geometry.points'), port('material', 'material.pbr'), port('camera', 'scene.camera'), port('light', 'scene.light'), port('light2', 'scene.light'), port('texture', 'frame.rgba')],
    outputs: [port('frame', 'frame.rgba')], params: {},
    execution: { visualPasses: 3, renderTargets: 5, stateful: false },
  },
];