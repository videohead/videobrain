import { Scene } from 'three/src/scenes/Scene.js';
import { PerspectiveCamera } from 'three/src/cameras/PerspectiveCamera.js';
import { Mesh } from 'three/src/objects/Mesh.js';
import { BoxGeometry } from 'three/src/geometries/BoxGeometry.js';
import { MeshStandardMaterial } from 'three/src/materials/MeshStandardMaterial.js';
import { AmbientLight } from 'three/src/lights/AmbientLight.js';
import { WebGPUFrameRuntime } from '../../src/engine/WebGPUFrameRuntime';
import { WEBGPU_FRAME_EFFECTS, type WebGPUFrameEffectKind } from '../../src/engine/WebGPUFrameEffects';
import { FRAME_EFFECT_SHADERS } from '../../src/engine/frameEffects';
import { FULLSCREEN_VERTEX_SHADER } from '../../src/engine/shaders';
import { getOperatorDefinition, type GraphParams } from '../../src/graph';

async function run() {
  const canvas = document.querySelector('canvas');
  if (!canvas) throw new Error('Fixture canvas missing.');
  const errors: string[] = [];
  const runtime = await WebGPUFrameRuntime.create(canvas, { onError: (error) => errors.push(error.message) });
  const source = runtime.createFrame(64, 48);
  const processed = runtime.createFrame(64, 48);
  runtime.clear(source, [0.25, 0.5, 0.75, 0.5]);
  runtime.process(source, processed);
  const flat = Array.from((await runtime.readFrame(processed)).slice(0, 4));
  const pendingScene = runtime.createSceneFrame(64, 48);
  const concurrentRejected = await runtime.createSceneFrame(64, 48).then(() => false, () => true);
  const sceneFrame = await pendingScene;
  const scene = new Scene();
  const geometry = new BoxGeometry();
  const material = new MeshStandardMaterial({ color: 0x40c080, metalness: 0, roughness: 0.7 });
  const mesh = new Mesh(geometry, material);
  scene.add(mesh, new AmbientLight(0xffffff, 3));
  const camera = new PerspectiveCamera(45, 64 / 48, 0.1, 100);
  camera.position.set(2, 1.5, 3);
  camera.lookAt(0, 0, 0);
  await runtime.renderScene(scene, camera, sceneFrame);
  runtime.process(sceneFrame, processed);
  runtime.present(processed);
  const pixels = await runtime.readFrame(processed);
  const visible = pixels.filter((value, index) => index % 4 === 3 && value > 0).length;
  const centerOffset = (24 * 64 + 32) * 4;
  const center = Array.from(pixels.slice(centerOffset, centerOffset + 4));
  material.transparent = true; material.opacity = 0.5; material.needsUpdate = true;
  await runtime.renderScene(scene, camera, sceneFrame);
  runtime.process(sceneFrame, processed);
  const translucent = Array.from((await runtime.readFrame(processed)).slice(centerOffset, centerOffset + 4));
  const before = runtime.status;
  runtime.release(sceneFrame); runtime.release(source); runtime.release(processed);
  const after = runtime.status;
  geometry.dispose(); material.dispose(); runtime.dispose();
  return { flat, visible, center, translucent, before, after, errors, concurrentRejected };
}

Reflect.set(globalThis, 'runWebGPUFixture', run);

function referencePixels(kind: WebGPUFrameEffectKind, source: HTMLCanvasElement, values: GraphParams) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width; canvas.height = source.height;
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false });
  if (!gl) throw new Error('Reference WebGL2 context unavailable.');
  function shader(type: number, code: string) {
    const compiled = gl!.createShader(type)!;
    gl!.shaderSource(compiled, code); gl!.compileShader(compiled);
    if (!gl!.getShaderParameter(compiled, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(compiled) ?? 'Shader failed.');
    return compiled;
  }
  const vertex = shader(gl.VERTEX_SHADER, FULLSCREEN_VERTEX_SHADER);
  const fragment = shader(gl.FRAGMENT_SHADER, FRAME_EFFECT_SHADERS[kind]);
  const program = gl.createProgram();
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Program failed.');
  gl.useProgram(program);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.uniform1i(gl.getUniformLocation(program, 'uSource'), 0);
  gl.uniform1i(gl.getUniformLocation(program, 'uMap'), 0);
  gl.uniform1f(gl.getUniformLocation(program, 'uHasMap'), 1);
  gl.uniform2f(gl.getUniformLocation(program, 'uResolution'), canvas.width, canvas.height);
  const definition = getOperatorDefinition(kind);
  for (const id of WEBGPU_FRAME_EFFECTS[kind].params) {
    const param = definition.params[id];
    const value = values[id] ?? param.defaultValue;
    const numeric = param.type === 'select' ? param.options.findIndex((option) => option.value === value) : Number(value);
    gl.uniform1f(gl.getUniformLocation(program, `u${id[0].toUpperCase()}${id.slice(1)}`), numeric);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const bottomUp = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
  const result = new Uint8Array(bottomUp.length);
  for (let row = 0; row < canvas.height; row++) result.set(bottomUp.subarray(row * canvas.width * 4, (row + 1) * canvas.width * 4), (canvas.height - 1 - row) * canvas.width * 4);
  gl.deleteTexture(texture); gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return result;
}

async function parity() {
  const canvas = document.querySelector('canvas')!;
  const errors: string[] = [];
  const runtime = await WebGPUFrameRuntime.create(canvas, { onError: (error) => errors.push(error.message) });
  const image = document.createElement('canvas'); image.width = 32; image.height = 24;
  const context = image.getContext('2d')!;
  const data = context.createImageData(image.width, image.height);
  for (let row = 0; row < image.height; row++) for (let column = 0; column < image.width; column++) {
    const offset = (row * image.width + column) * 4;
    data.data.set([column * 7, row * 10, (column * 13 + row * 17) % 256, 64 + (column * 3 + row * 5) % 192], offset);
  }
  context.putImageData(data, 0, 0);
  const source = runtime.createFrame(image.width, image.height);
  const target = runtime.createFrame(image.width, image.height);
  runtime.upload(source, image);
  const cases: [WebGPUFrameEffectKind, GraphParams][] = [
    ...Object.keys(WEBGPU_FRAME_EFFECTS).map((kind): [WebGPUFrameEffectKind, GraphParams] => [kind as WebGPUFrameEffectKind, {}]),
    ['levels', { black: 0.1, white: 0.9, gamma: 1.4, gain: 0.8, lift: 0.05 }],
    ['hsv', { mode: 'hsl', hue: -0.2, saturation: 1.7, brightness: 0.1 }],
    ['lumaKey', { softness: 0, invert: 'on' }],
    ['chromaKey', { red: 0.4, green: 0.6, blue: 0.2, tolerance: 0.3, softness: 0.2, spill: 0.8 }],
    ['crossfade', { mix: 0.3, curve: 'easeOut' }],
    ['displace', { amountX: -0.5, amountY: 0.7, edgeMode: 'mirror' }],
    ['displace', { amountX: 0.4, amountY: -0.8, edgeMode: 'transparent' }],
    ['edge', { strength: 0.4, invert: 'on' }],
    ['pixelate', { size: 7 }],
    ['kaleidoscope', { mode: 'repeat', repeatX: 2, repeatY: 3, rotation: 42, centerY: 0.4 }],
    ['channelShuffle', { red: 'alpha', green: 'luma', blue: 'zero', alpha: 'one' }],
  ];
  const results = [];
  for (const [kind, values] of cases) {
    runtime.effect(kind, source, source, target, values);
    const actual = await runtime.readFrame(target);
    const expected = referencePixels(kind, image, values);
    let maxDifference = 0;
    for (let index = 0; index < actual.length; index++) maxDifference = Math.max(maxDifference, Math.abs(actual[index] - expected[index]));
    results.push({ kind, values, maxDifference });
  }
  runtime.effect('crossfade', null, null, target);
  const missing = Array.from((await runtime.readFrame(target)).slice(0, 4));
  runtime.clear(source, [1, 0, 0, 0.5]);
  runtime.effect('crossfade', source, null, target, { mix: 0.5 });
  const faded = Array.from((await runtime.readFrame(target)).slice(0, 4));
  let uploadRejected = false;
  image.width++;
  try { runtime.upload(source, image); } catch { uploadRejected = true; }
  let selfReadRejected = false;
  try { runtime.effect('levels', source, null, source); } catch { selfReadRejected = true; }
  runtime.release(source);
  let releasedRejected = false;
  try { runtime.clear(source, [0, 0, 0, 0]); } catch { releasedRejected = true; }
  runtime.dispose();
  return { results, errors, missing, faded, uploadRejected, selfReadRejected, releasedRejected };
}

Reflect.set(globalThis, 'runWebGPUParity', parity);