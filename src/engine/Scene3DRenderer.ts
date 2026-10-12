import * as THREE from 'three';
import { DEFAULT_CAMERA, DEFAULT_LIGHT, DEFAULT_MATERIAL, validateGeometry, type Camera3DValue, type Geometry3DValue, type Light3DValue, type Material3DValue } from '../graph/scene3d';
import { planInstanceBatch, type BatchSourceStats, type ScenePlacement } from '../graph/sceneInstancing';

interface SceneEntry {
  target: THREE.WebGLRenderTarget;
  texture: THREE.FramebufferTexture;
  objects: Map<string, { key: string; object: THREE.Mesh | THREE.Points | THREE.Line }>;
}
export interface Scene3DAssetInstance {
  object: THREE.Object3D;
  placement: { position: readonly number[]; rotation: readonly number[]; scale: readonly number[] };
  placements?: readonly { position: readonly number[]; rotation: readonly number[]; scale: readonly number[] }[];
}
export interface Scene3DInput {
  geometry: Geometry3DValue | null;
  points: Geometry3DValue | null;
  material?: Material3DValue;
  camera?: Camera3DValue;
  lights: Light3DValue[];
  asset?: Scene3DAssetInstance | null;
}
/** Aggregate batch report surfaced for diagnostics and budgets. */
export interface Scene3DBatchReport {
  instances: number;
  drawCalls: number;
  instancedDrawCalls: number;
  triangles: number;
  diagnostics: readonly string[];
}

function collectBatchStats(object: THREE.Object3D): BatchSourceStats {
  let drawCalls = 0;
  let triangles = 0;
  let textures = 0;
  const seenTextures = new Set<unknown>();
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) {
      return;
    }
    drawCalls += 1;
    const position = mesh.geometry.getAttribute('position');
    if (position) {
      const index = mesh.geometry.getIndex();
      triangles += index ? index.count / 3 : position.count / 3;
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const map = (material as THREE.MeshStandardMaterial).map ?? null;
      if (map && !seenTextures.has(map)) {
        seenTextures.add(map);
        textures += 1;
      }
    }
  });
  return { drawCalls, triangles: Math.round(triangles), textures };
}

function geometryFor(value: Geometry3DValue): THREE.BufferGeometry {
  validateGeometry(value);
  switch (value.shape) {
    case 'box': return new THREE.BoxGeometry(value.width, value.height, value.depth, value.detail, value.detail, value.detail);
    case 'sphere': return new THREE.SphereGeometry(0.5, value.detail, value.detail).scale(value.width, value.height, value.depth);
    case 'plane': return new THREE.PlaneGeometry(value.width, value.height, value.detail, value.detail);
    case 'cylinder': return new THREE.CylinderGeometry(value.width / 2, value.width / 2, value.height, value.detail).scale(1, 1, value.depth / value.width);
    default: {
      const countY = value.shape === 'line' ? 1 : value.countY;
      const positions: number[] = [];
      for (let row = 0; row < countY; row++) for (let column = 0; column < value.countX; column++) {
        positions.push((column / (value.countX - 1) - 0.5) * value.width, countY === 1 ? 0 : (row / (countY - 1) - 0.5) * value.height, 0);
      }
      return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    }
  }
}

function disposeObject(object: THREE.Mesh | THREE.Points | THREE.Line) {
  object.geometry.dispose();
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  materials.forEach((material) => material.dispose());
}

/** Dispose only batch-created InstancedMeshes; source geometry is shared. */
function disposeInstancedGroup(group: THREE.Group): void {
  for (const child of group.children) {
    const instanced = child as THREE.InstancedMesh;
    if ((instanced as unknown as { isInstancedMesh?: boolean }).isInstancedMesh !== true) continue;
    instanced.dispose();
  }
  group.clear();
}

function applyPlacement(object: THREE.Object3D, placement: ScenePlacement): void {
  object.position.set(placement.position[0] ?? 0, placement.position[1] ?? 0, placement.position[2] ?? 0);
  object.rotation.set(
    THREE.MathUtils.degToRad(placement.rotation[0] ?? 0),
    THREE.MathUtils.degToRad(placement.rotation[1] ?? 0),
    THREE.MathUtils.degToRad(placement.rotation[2] ?? 0),
    'XYZ',
  );
  object.scale.set(placement.scale[0] ?? 1, placement.scale[1] ?? 1, placement.scale[2] ?? 1);
  object.updateMatrixWorld(true);
}

function placementMatrix(placement: ScenePlacement): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(placement.position[0] ?? 0, placement.position[1] ?? 0, placement.position[2] ?? 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(placement.rotation[0] ?? 0),
      THREE.MathUtils.degToRad(placement.rotation[1] ?? 0),
      THREE.MathUtils.degToRad(placement.rotation[2] ?? 0),
      'XYZ',
    )),
    new THREE.Vector3(placement.scale[0] ?? 1, placement.scale[1] ?? 1, placement.scale[2] ?? 1),
  );
}

function applyInstancedPlacements(group: THREE.Group, placements: readonly ScenePlacement[]): void {
  const children = group.children as THREE.InstancedMesh[];
  for (const batch of children) {
    if ((batch as unknown as { isInstancedMesh?: boolean }).isInstancedMesh !== true) {
      continue;
    }
    const sourceMatrix = batch.userData.sourceMatrix as THREE.Matrix4 | undefined;
    for (let index = 0; index < batch.count; index += 1) {
      const placement = placements[index];
      if (!placement) {
        batch.setMatrixAt(index, new THREE.Matrix4().makeScale(0, 0, 0));
        continue;
      }
      batch.setMatrixAt(
        index,
        sourceMatrix
          ? placementMatrix(placement).multiply(sourceMatrix)
          : placementMatrix(placement),
      );
    }
    batch.instanceMatrix.needsUpdate = true;
  }
}

export class Scene3DRenderer {
  private renderer: THREE.WebGLRenderer;
  private entries = new Map<string, SceneEntry>();
  /** Cached stats per decoded scene object, keyed by object identity. */
  private batchStatsByObject = new WeakMap<THREE.Object3D, BatchSourceStats>();
  /** Cached InstancedMesh groups keyed by source object + instance count. */
  private instancedGroups = new Map<string, { key: string; group: THREE.Group }>();
  constructor(private gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, context: gl, alpha: true, antialias: false, premultipliedAlpha: false });
    this.renderer.autoClear = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0, 0);
  }
  private collectStats(object: THREE.Object3D): BatchSourceStats {
    const cached = this.batchStatsByObject.get(object);
    if (cached) return cached;
    const stats = collectBatchStats(object);
    this.batchStatsByObject.set(object, stats);
    return stats;
  }
  /**
   * Build or reuse one InstancedMesh per static mesh in the source scene.
   * One GPU draw per distinct mesh regardless of instance count. Batches are
   * cached by source object + count and disposed when the count changes or the
   * source scene is released.
   */
  private instancedGroupFor(source: THREE.Object3D, count: number): THREE.Group | null {
    const key = `${count}`;
    let cached = this.instancedGroups.get(source.uuid);
    if (!cached || cached.key !== key) {
      if (cached) disposeInstancedGroup(cached.group);
      const group = new THREE.Group();
      source.updateMatrixWorld(true);
      source.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if ((mesh as unknown as { isMesh?: boolean }).isMesh !== true) {
          return;
        }
        const instanced = new THREE.InstancedMesh(mesh.geometry, mesh.material as THREE.Material, count);
        instanced.userData.sourceMatrix = mesh.matrixWorld.clone();
        instanced.userData.sourceOffset = [child.position.x, child.position.y, child.position.z];
        group.add(instanced);
      });
      if (group.children.length === 0) return null;
      cached = { key, group };
      this.instancedGroups.set(source.uuid, cached);
    }
    return cached.group;
  }
  retain(ids: Set<string>) {
    for (const [id, entry] of this.entries) if (!ids.has(id)) {
      entry.target.dispose(); entry.texture.dispose();
      entry.objects.forEach(({ object }) => disposeObject(object));
      this.entries.delete(id);
    }
  }
  dispose() {
    this.retain(new Set());
    for (const { group } of this.instancedGroups.values()) disposeInstancedGroup(group);
    this.instancedGroups.clear();
    this.renderer.dispose();
  }
  render(id: string, input: Scene3DInput, width: number, height: number, output: WebGLFramebuffer, textureSource?: WebGLFramebuffer): Scene3DBatchReport {
    const gl = this.gl;
    this.renderer.resetState();
    let entry = this.entries.get(id);
    if (!entry || entry.target.width !== width || entry.target.height !== height) {
      if (entry) { entry.target.dispose(); entry.texture.dispose(); entry.objects.forEach(({ object }) => disposeObject(object)); }
      const target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true, stencilBuffer: false, samples: 0 });
      target.texture.colorSpace = THREE.SRGBColorSpace;
      const texture = new THREE.FramebufferTexture(width, height);
      texture.colorSpace = THREE.LinearSRGBColorSpace;
      entry = { target, texture, objects: new Map() };
      this.entries.set(id, entry);
    }
    try {
      if (textureSource) {
        this.renderer.initTexture(entry.texture);
        gl.bindFramebuffer(gl.FRAMEBUFFER, textureSource);
        this.renderer.copyFramebufferToTexture(entry.texture);
        this.renderer.resetState();
      }
      const scene = new THREE.Scene();
      const material = input.material ?? DEFAULT_MATERIAL;
      for (const [slot, value] of [['geometry', input.geometry], ['points', input.points]] as const) {
        const previous = entry.objects.get(slot);
        if (!value) { if (previous) { disposeObject(previous.object); entry.objects.delete(slot); } continue; }
        validateGeometry(value);
        const key = JSON.stringify({ ...value, transforms: [] });
        let cached = previous;
        if (!cached || cached.key !== key) {
          if (cached) disposeObject(cached.object);
          const geometry = geometryFor(value);
          const object = value.shape === 'grid' ? new THREE.Points(geometry, new THREE.PointsMaterial())
            : value.shape === 'line' ? new THREE.Line(geometry, new THREE.LineBasicMaterial())
            : new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }));
          cached = { key, object }; entry.objects.set(slot, cached);
        }
        const object = cached.object;
        const objectMaterial = object.material as THREE.MeshStandardMaterial | THREE.PointsMaterial | THREE.LineBasicMaterial;
        objectMaterial.color.setRGB(material.color[0] ?? 0, material.color[1] ?? 0, material.color[2] ?? 0, THREE.SRGBColorSpace);
        const transparent = material.opacity < 1 || Boolean(textureSource);
        if (objectMaterial.transparent !== transparent) { objectMaterial.transparent = transparent; objectMaterial.needsUpdate = true; }
        objectMaterial.opacity = material.opacity;
        objectMaterial.depthWrite = !transparent;
        if (objectMaterial instanceof THREE.MeshStandardMaterial) {
          objectMaterial.metalness = material.metalness; objectMaterial.roughness = material.roughness;
          objectMaterial.emissive.copy(objectMaterial.color); objectMaterial.emissiveIntensity = material.emissive;
          objectMaterial.wireframe = material.wireframe;
          const map = textureSource ? entry.texture : null;
          if (objectMaterial.map !== map) { objectMaterial.map = map; objectMaterial.needsUpdate = true; }
        } else if (objectMaterial instanceof THREE.PointsMaterial) objectMaterial.size = material.pointSize;
        object.matrixAutoUpdate = false;
        object.matrix.identity();
        for (const transform of value.transforms) {
          const position = new THREE.Vector3(...transform.position as [number, number, number]);
          const pivot = new THREE.Vector3(...transform.pivot as [number, number, number]);
          const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...transform.rotation.map(THREE.MathUtils.degToRad) as [number, number, number], 'XYZ'));
          const matrix = new THREE.Matrix4().makeTranslation(position.add(pivot));
          matrix.multiply(new THREE.Matrix4().compose(new THREE.Vector3(), quaternion, new THREE.Vector3(...transform.scale as [number, number, number])));
          matrix.multiply(new THREE.Matrix4().makeTranslation(pivot.negate()));
          object.matrix.premultiply(matrix);
        }
        object.matrixWorldNeedsUpdate = true;
        scene.add(object);
      }
      const asset = input.asset;
      const batchReport: Scene3DBatchReport = { instances: 0, drawCalls: 0, instancedDrawCalls: 0, triangles: 0, diagnostics: [] };
      if (asset?.object) {
        const placements = (asset.placements ?? [asset.placement]) as unknown as readonly ScenePlacement[];
        const stats = this.collectStats(asset.object);
        const batch = planInstanceBatch(placements, stats);
        batchReport.instances = batch.placements.length;
        batchReport.drawCalls = batch.drawCalls;
        batchReport.triangles = batch.triangles;
        batchReport.diagnostics = batch.diagnostics;
        if (batch.instancing) {
          const group = this.instancedGroupFor(asset.object, batch.placements.length);
          if (group) {
            applyInstancedPlacements(group, batch.placements);
            batchReport.instancedDrawCalls = group.children.length;
            scene.add(group);
          } else {
            batchReport.diagnostics = [
              ...batchReport.diagnostics,
              'The scene meshes are not compatible with GPU instancing; rendering duplicated placements instead.',
            ];
            for (const placement of batch.placements) {
              const wrapper = new THREE.Group();
              applyPlacement(wrapper, placement);
              wrapper.add(asset.object.clone());
              scene.add(wrapper);
            }
          }
        } else {
          // Fallback: duplicated placements, one group per instance, sharing
          // geometry/materials through clones. Diagnostics already explain why.
          for (const placement of batch.placements) {
            const wrapper = new THREE.Group();
            applyPlacement(wrapper, placement);
            wrapper.add(asset.object.clone());
            scene.add(wrapper);
          }
        }
      }
      for (const value of input.lights.length ? input.lights : [DEFAULT_LIGHT]) {
        const color = new THREE.Color().setRGB(value.color[0] ?? 1, value.color[1] ?? 1, value.color[2] ?? 1, THREE.SRGBColorSpace);
        const light = value.mode === 'ambient' ? new THREE.AmbientLight(color, value.intensity) : value.mode === 'point' ? new THREE.PointLight(color, value.intensity, 0, 2) : new THREE.DirectionalLight(color, value.intensity);
        light.position.set(value.position[0] ?? 0, value.position[1] ?? 0, value.position[2] ?? 0);
        scene.add(light);
      }
      const view = input.camera ?? DEFAULT_CAMERA;
      const aspect = width / height;
      const camera = view.mode === 'orthographic' ? new THREE.OrthographicCamera(-view.span * aspect / 2, view.span * aspect / 2, view.span / 2, -view.span / 2, view.near, view.far) : new THREE.PerspectiveCamera(view.fov, aspect, view.near, view.far);
      camera.position.set(view.position[0] ?? 3, view.position[1] ?? 2, view.position[2] ?? 4);
      const target = new THREE.Vector3(view.target[0] ?? 0, view.target[1] ?? 0, view.target[2] ?? 0);
      if (camera.position.distanceToSquared(target) < 0.000001) camera.position.z += 0.001;
      camera.lookAt(target);
      this.renderer.setRenderTarget(entry.target);
      this.renderer.render(scene, camera);
      const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, output);
      gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error(`3D GPU transfer failed (${error}).`);
      return batchReport;
    } finally {
      this.renderer.setRenderTarget(null);
      this.renderer.resetState();
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.STENCIL_TEST);
      gl.colorMask(true, true, true, true); gl.depthMask(true);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    }
  }
}