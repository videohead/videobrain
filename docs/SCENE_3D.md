# 3D Scene Foundation

The 3D Scene category adds fifteen nodes: Vector 2/3/4, Split Vector 2/3/4,
Primitive 3D, Grid / Line 3D, Transform 3D, Camera 3D, Light 3D, PBR Material,
Asset 3D, Instance 3D, and Render 3D. These are source-implemented features;
deployment is separate. Particles, general scene hierarchies, and animated
instancing remain P1/P-later; static GLB/glTF import and bounded static GPU
instancing now ship via Asset 3D and Instance 3D.

## Teaching patches

**3D Primitive Lab** connects Primitive 3D through Transform 3D to Render 3D,
then Color Grade and Display. A slow Oscillator and Map Range animate rotation.
Gradient supplies the mesh base-color map, PBR Material controls shading, and
directional plus ambient lights illuminate the result. Camera 3D offers
perspective/orthographic views. Pause freezes the upstream motion; Return to
frame zero reproduces its initial state. All assets are procedural.

**Vector & Grid Lab** composes and splits vec2/vec3/vec4 signals, positions a
point grid, and controls its color and opacity. Switch Grid / Line 3D to line
for a connected X-axis line. Point and line materials use unlit base color,
not PBR lighting; Point size is measured in world units with perspective
attenuation. Neither example requests permissions or a network connection.

## Typed contracts

| Signal | Producer / consumer | Meaning |
| --- | --- | --- |
| `control.vec2/vec3/vec4` | Vector / Split Vector; scene vector inputs | Ordered finite components, explicit conversion to/from scalar controls |
| `geometry.mesh` | Primitive 3D, Transform 3D / Render 3D | Bounded primitive descriptor with ordered local transforms |
| `geometry.points` | Grid / Line 3D, Transform 3D / Render 3D | Bounded point grid or connected line descriptor |
| `material.pbr` | PBR Material / Render 3D | Base RGB, metalness, roughness, emissive strength, opacity, wireframe, point size |
| `scene.camera` | Camera 3D / Render 3D | Projection, world position, target, near/far planes, FOV or orthographic height |
| `scene.light` | Light 3D / Render 3D | Directional, point, or ambient light with color, intensity, and position |
| `frame.rgba` | Render 3D / existing frame nodes | Output-sized straight-alpha RGBA frame; depth is internal only |

Each port's index is its registry order. Render 3D inputs are geometry, points,
material, camera, light, light2, texture, light3 (indexes 0..7); output frame is index 0.
Light 3 is appended after texture to preserve all existing input indexes.
Transform 3D carries separate mesh and point inputs/outputs without coercion.
Numeric scalar inputs follow structured inputs in parameter declaration order.
Vector inputs take precedence over the matching scalar inputs and saved
literals; disconnecting restores those scalar bindings/literals. Registry
defaults, bounds, steps, and select IDs are authoritative.

Missing mesh/points render transparent. Missing material/camera use the defaults
below. With no connected lights, Render 3D uses one default directional light;
with any of the three lights connected, only the supplied lights apply. Missing frame
texture means no map. Split Vector without input emits zero components;
Transform without geometry emits an empty descriptor. There is no implicit
mesh-to-points, scalar-to-vector, or frame-to-depth conversion.

## Coordinates and defaults

- Right-handed world coordinates, Y up, arbitrary world units. Geometry is
  centered at the origin; planes/grids occupy XY and lines follow X.
- Mesh defaults to a unit box at detail 8. Shapes are box, sphere, plane, and
  cylinder. Width/height/depth are 0.01..20; sphere dimensions are full diameters.
  Cylinder height is Y and width/depth define the XZ cross-section.
- Detail is floored to an integer in 3..24. Box/plane use subdivision detail;
  sphere uses it for longitude/latitude; cylinder for radial segments.
- Grid defaults to 2x2 world units with 16x16 points. Counts are floored to
  2..64. Line uses X count only. No particles or simulation state are implied.
- Transform defaults to zero position/rotation/pivot and unit scale. Translation
  and pivot are -20..20, rotation is -360..360 degrees, scale is 0.01..10.
  Each transform applies `T(position+pivot) * R(XYZ) * S * T(-pivot)`.
  Chaining prepends each downstream transform to the accumulated matrix,
  providing explicit nested transformation order without a mutable scene tree.
- Camera defaults to perspective, position (3,2,4), target origin, vertical
  FOV 45 degrees, near 0.01, far 100. Orthographic span is vertical height,
  default 4; width follows output aspect. Coincident position/target receives
  a small Z separation to keep the view defined.
- Default material: RGB (0.2,0.7,0.55), metalness 0.1, roughness 0.45,
  emissive 0, opacity 1, wireframe off, point size 0.06. Meshes are double-sided;
  transparent meshes use Three.js sorting, not order-independent transparency.
- Default light: white directional intensity 3 at (3,4,5), targeting origin.
  Point light uses inverse-square falloff; ambient ignores position.

## GPU ownership and budgets

Three.js r180 shares the existing WebGL2 context and is created lazily when a
reachable Render 3D runs. Each Render 3D accepts at most one mesh and one
point/line stream, one material, one camera, three lights, and one frame texture.
Geometry/material objects are cached per input slot; changing geometry replaces
and disposes it, while numeric material/transform changes update existing objects.

Three.js owns its color/depth target and optional frame-map copy texture.
VideoBrain owns an intermediate color target and the final graph frame target.
The frame map is copied with `copyTexSubImage2D`; the rendered color is blitted
to the intermediate target, then unpremultiplied by one fullscreen graph pass.
No pixels are read back to the CPU during production rendering. WebGL state is
reset at each library boundary. The graph supplies output size/aspect; no
independent Three.js canvas, display loop, or pixel-ratio policy is introduced.

Each Render 3D conservatively reserves three visual passes and five output-sized
RGBA-equivalent resource units (including depth and map storage). This is a
budget reservation, not a measured pass counter. The map copy and blit consume
bandwidth even though they are not draw calls. Inspection reports a ceiling of
8192 triangles, 4096 points, four draw calls including conversion and possible
double-sided transparency, and one texture slot per Render 3D. Transform chains
are limited to 16 levels and rejected by the compiler when exceeded. Existing
global frame/pass/target/pixel limits continue to apply without being raised.

Targets are recreated on size changes. Inactive/deleted Render 3D nodes release
their scene resources; removing the last one disposes the Three.js renderer.
Context loss disposes its session, and restoration reconstructs from graph
descriptors. Reset has no 3D history to clear: results depend only on resolved
current inputs. Shadows, environment maps, imported textures, and GPU simulation
are not allocated by this foundation.

## Color and compatibility

Literal material/light RGB is interpreted as sRGB and converted by Three.js.
Rendering outputs sRGB-valued color for the existing frame pipeline. Copied
graph frame textures use RGBA8-compatible linear storage and are treated as
working RGB values for material sampling; this is not a new color-managed
linear-light graph contract. Tone mapping is disabled. Alpha is converted back
to the straight-alpha convention used by existing compositors.

The 3D foundation was introduced in catalog 17; catalog 18 appends optional
Light 3 without changing existing port indexes. Project schema stays 1 and
existing projects require no migration.
Older applications reject unknown kinds rather than silently rewriting them.
Runtime Three.js objects and GPU handles are never serialized.

## Imported GLB/glTF assets (Asset 3D)

Catalog 22 adds the **Asset 3D** node and a `scene.asset` port. Asset 3D
references a durable imported static GLB/glTF model by content identity
(`assetId` + SHA-256 `assetHash`) and an explicit placement transform
(position, rotation in degrees, scale). Its `scene.asset` output connects to the
appended Render 3D `assetScene` input (index 8); existing Render 3D indexes and
primitive semantics are unchanged.

Import flows through the Inspector's model control: a local `.glb`/`.gltf` file is
validated with a GPU-free preflight (container/accessor bounds, triangle budget,
external-URI ban, static-subset enforcement that rejects skins and animation),
then ingested into the durable AssetStore (IndexedDB) under its content hash.
Only the content identity and placement are stored on the node; the model bytes
live in asset storage, so saved projects reopen and re-resolve the asset. A
missing asset keeps the node and offers a relink; duplicating the node yields
independent placement that shares the cached GPU scene by content hash.

Decoding uses the pinned Three.js GLTFLoader with an empty resource path, so no
implicit network fetch occurs. Imported cameras and lights are not activated;
graph Camera 3D and Light 3D remain authoritative. The `local-glb-stage` preset
demonstrates the import-to-render path.

## GPU instance batches (Instance 3D)

Catalog 23 adds the **Instance 3D** node. It consumes one `scene.asset`
placement and emits a bounded batch of per-instance transforms in a grid or
ring layout (1..64 instances, controlled spacing/radius). The source placement
transform is applied under every instance, so the Asset 3D node stays the
single editable placement authority; duplicating an Asset 3D node remains
independent scene duplication, not GPU instancing.

Rendering builds one `InstancedMesh` per static mesh in the decoded scene, so
instance count does not multiply draw calls: 64 instances of a one-mesh model
are one GPU draw. Batches are validated before rendering against aggregate
budgets (65,536 triangles, 64 distinct mesh draws, 64 texture slots, 64
placements). Incompatible or over-budget batches never freeze or strip
content: the renderer reports the first diagnostic on the render result and
falls back to duplicated placements sharing geometry and materials. Skins and
animation remain outside the static subset (rejected at import), so instanced
characters are not implied by static batches.

Shared-resource cleanup keeps a single decoded scene per content hash. Batch
`InstancedMesh`es are cached per source scene and instance count, rebuilt when
the count changes, and disposed when the last Render 3D releases the scene or
the renderer is disposed. `WebGLRenderer.getLastBatchReport()` exposes the
latest aggregate (instances, draw calls, instanced draw calls, triangles,
diagnostics) as performance evidence for tests and tooling. The
`instance-glb-stage` preset demonstrates the import → instance → render path.

## Verification

Tests cover vector composition/splitting, descriptor limits, serialization,
incompatible wires, overlong chains, catalog budgets, and reachable examples.
GPU browser tests cover textured geometry, frame-effect composition, transparency,
camera modes, motion/reset, points/lines, responsive rendering, context recovery,
and switching back to 2D. Physical low-power GPUs and broader browser/device
performance remain a release-validation task.