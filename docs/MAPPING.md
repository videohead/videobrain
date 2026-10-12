# Projection Mapping and Overlap Blending

Covers the surface mapping stack: geometry and layout validation (M1), the
manual surface and mask editor (M2), named outputs and persistence (M3), and
overlap blending (M4). Read [Contracts](p0/CONTRACTS.md) for the shared types
and [Current State](CURRENT_STATE.md) for what is shipped overall.

## Coordinate conventions

There are exactly two spaces, and one pair of functions converts between them.

| Space | Origin | Y direction | Used by |
| --- | --- | --- | --- |
| Screen | top-left | down | Projector Mapping corners, canvas pixels, pointer events |
| Frame / surface UV | bottom-left | up | Frame sampling, mesh vertices, mask points |

`screenToFrameUv` and `frameUvToScreen` in
[surfaceLayout.ts](../src/engine/surfaceLayout.ts) own the flip. No other
module should invert Y inline.

Projector Mapping's four corners are, in order, top-left, top-right,
bottom-right, bottom-left, in screen space. `meshFromProjectionCorners` and
`projectionCornersFromMesh` bridge that order to a 1x1 warp mesh without
changing it.

## Geometry limits

| Limit | Value | Meaning |
| --- | --- | --- |
| `MAX_SURFACE_MESH_SPAN` | 32 | Mesh cells on one axis |
| `MAX_SURFACE_MESH_CELLS` | 1024 | Mesh cells in total |
| `MAX_SURFACE_MASK_NODES` | 64 | Authored Bezier nodes per path |
| `MAX_SURFACE_MASK_POINTS` | 256 | Tessellated points per path |
| `MAX_SURFACE_MASK_PATHS` | 16 | Mask paths per surface |
| `MAX_OUTPUT_LAYOUTS` | 8 | Logical outputs per project |
| `MAX_OUTPUT_DIMENSION` | 7680 | Longest edge of one output, in pixels |
| `MAX_TOTAL_OUTPUT_PIXELS` | 7680x4320 | Addressable pixels across all outputs |

These are application caps, not device limits. They are M1/M4 proposals and
still need C3 measurement sign-off.

A mesh cell is rejected when it is degenerate or folded, using one
cross-product sign test per corner. An edit that would produce such a cell is
refused and the previous layout is kept, so a bad drag cannot destroy a
working alignment.

## Editing

The editor state in [surfaceEditor.ts](../src/engine/surfaceEditor.ts) holds no
UI. Every mutation is routed through the layout validator, and a refused edit
is not recorded in history. Undo and redo operate on whole layout snapshots,
which keeps undo correct across mixed mesh and mask edits.

Freehand mask input is simplified with Ramer-Douglas-Peucker and fitted to
cubic nodes, so a drawn mask remains editable afterwards. This is the
mask/boundary interpretation of FreeDraw. **Painted brush content is a
separate approved child task and is not implemented.**

## Outputs

One output is composed by drawing its surfaces in `layerIndex` order, each
through its own scratch layer so masking cannot erase earlier surfaces. Every
upstream source node is resolved at most once per frame even when several
surfaces share it or slice different regions of it; `ComposeReport.sourceEvaluations`
reports the actual count.

A presentation window shows only the composited output. The Window Management
API is used when the browser offers it and the user grants permission, which
allows an output to be bound to a named screen. When it is unavailable or
denied, the window still opens and stays manually placeable. Screen binding
records the screen an operator chose; it is not a placement, refresh, or frame-lock
guarantee.

## Overlap blending

### What the blend computes

Two projectors covering a shared band must together emit exactly one screen's
worth of light. That is a statement about linear light, so the weight is
computed in linear light and encoded with the display gamma only at the end.

The weight family is

$$w(t) = \frac{t^p}{t^p + (1-t)^p}$$

which satisfies $w(t) + w(1-t) = 1$ for every exponent $p$. An operator can
reshape the ramp with $p$ without ever breaking the sum. The encoded signal is
$w^{1/\gamma}$.

Because encoding is a power function it is multiplicative, so
$\mathrm{enc}(a)\,\mathrm{enc}(b) = \mathrm{enc}(ab)$. Each edge can therefore be
applied as an independent gradient pass and a corner still receives the correct
product.

Settings are saved per output: per-edge overlap widths, curve exponent, gamma,
brightness trim, and black-level lift.

### The black-level limitation

A blend curve scales light **down**. It can never remove the light a projector
emits for black. Inside an overlap two black floors add, so that band is
brighter in black than the rest of the image. No curve, gamma, or brightness
setting removes this.

The only mitigation is to raise black everywhere else to match, which costs
contrast. For a projector with a 2% black floor:

| Quantity | Value |
| --- | --- |
| Black outside the overlap | 0.02 |
| Black inside the overlap | 0.04 |
| Lift required for uniformity | 0.02 |
| Static contrast before lift | 50:1 |
| Static contrast after lift | 25:1 |

`blackLevelReport` in [edgeBlend.ts](../src/engine/edgeBlend.ts) computes this
trade so it is reported rather than hidden.

### Calibration patterns

| Pattern | Purpose |
| --- | --- |
| `grid` | Geometric alignment reference with a border |
| `blend-edges` | Marks where each active overlap reaches full brightness |
| `flat-field` | Uniform 50% field for spotting a seam against the surface |

## Verification status

### Verified in this repository

Mathematical and signal-domain behaviour only, under
[edgeBlend.test.ts](../src/engine/edgeBlend.test.ts) and the surrounding
mapping suites:

- Opposing ramps sum to unit light to within 1e-9 for every supported curve.
- A mismatched curve between two projectors opens a measurable seam, so the
  test is discriminating rather than vacuous.
- Gamma encode/decode round-trips; encoding is multiplicative across edges.
- Per-edge widths, corner products, and non-overlapping edges behave as specified.
- Out-of-range widths, curves, gammas, brightness, and lifts are rejected;
  opposing widths that leave no full-brightness interior are rejected.
- Blend settings survive save and reopen per output.

### NOT verified — physical gate is BLOCKED

**No claim of seamless physical projection is made or supported by any test in
this repository.** Canvas alpha is not calibrated light output. The following
are unverified and require hardware:

- Real projector gamma, which is assumed, not measured.
- Colour primaries, white point, and inter-projector colour match.
- Lamp or laser output drift, uniformity, and hot-spotting.
- Actual black floor, which varies by projector, lens, and ambient light.
- Geometric stability of a physical alignment over time and temperature.

### Proposed physical rig and tolerances — AWAITING USER AGREEMENT

These numbers are a **proposal for the user to accept, amend, or reject**. They
are not accepted tolerances, and M4's physical gate stays blocked until the
user approves a rig and an independent reviewer signs off on measured results.

| Item | Proposed |
| --- | --- |
| Projectors | Two units, same model, same firmware, same picture mode |
| Surface | Flat matte white screen, measured and recorded gain |
| Overlap | 15% of horizontal width, both units set to the same width and curve |
| Ambient | Measured and recorded; blackout preferred |
| Warm-up | 30 minutes before any measurement |
| Instrument | Calibrated luminance meter; model and calibration date recorded |

| Measurement | Proposed tolerance |
| --- | --- |
| White-field luminance across the seam | within ±5% of the non-overlap field |
| Visible seam on a 50% flat field | none at 2x screen-height viewing distance |
| Black-field luminance in the overlap | recorded, with the contrast cost stated |
| Geometric alignment at the overlap | within 1 pixel at output resolution |
| Colour difference across the seam | ΔE recorded; threshold to be agreed |

Required before the gate can close: the rig above approved by the user, the
measurements taken and recorded with instrument details, and an independent
reviewer sign-off. Fixture success alone does not close it.
