# Signal tests

Signal Number, Signal Text, Signal Edge, and Signal Bang are monitoring demand
roots in the Output category. They evaluate upstream controls without a Display
and add zero GPU passes. They also have typed pass-through outputs, so they can
be inserted into a chain or connected as a debugging branch.

## Readouts

| Node | Input/output type | Display |
| --- | --- | --- |
| Signal Number | `control.f32` | Actual value, configurable decimals, and a range meter; values outside the meter range are not clamped on output |
| Signal Text | `text.utf8` | Literal text, including newlines; preview limited to 2048 characters, full input forwarded |
| Signal Edge | `control.bool` | HIGH/LOW state, rising and falling counts, last edge time, and a leading-edge lamp |
| Signal Bang | `event.trigger` | Incoming event count, last event time, dropped count, and a circular manual trigger/indicator |

Each node has an optional Label for identifying probes. An unconnected readout
is explicitly marked; numeric/boolean/text outputs default to zero/false/empty.
Signal Edge seeds its first connected state without counting an edge. Use
Control to Bool before it to inspect a scalar threshold crossing. Both positive
and negative values work with Math, Map Range, and Smooth upstream or downstream.

## Bang behavior

The interaction is informed by Cycling '74's
[Basic Tutorial 2: Bang!](https://docs.cycling74.com/legacy/max8/tutorials/basicchapter02):
a button can visibly receive an occurrence, forward it, or initiate one manually.
Click Signal Bang or focus it and press Enter/Space to emit an event. Chained
Signal Bang nodes show the event progressing through the graph. Outputs can
branch to multiple destinations.

VideoBrain retains its own contracts: a bang is an explicit event, not a
universal instruction to every node. Execution follows compiler dependency
order, not right-to-left canvas position. Each input retains its single-wire
connection rule; no implicit event merging or arbitrary message coercion is added.
Incoming events keep their identity when forwarded. Duplicate IDs are suppressed
within a bounded 4096-ID window; at most 64 events are forwarded per tick.
Manual events receive new IDs and use the current visual transport time.

Manual bangs work while paused: a held redraw propagates them through the active
graph. The visible flash lasts 80..1000 ms of wall time and fades even when the
transport is paused. Flash duration changes only the lamp, never event timing
or pulse length. Readouts publish at most about 20 times per second; event and
edge counting happens on every evaluated tick. This is not a hardware oscilloscope
and cannot recover scalar edges missed between visual samples.

Clear counts resets displayed statistics, not event identity deduplication or
downstream state. Transport reset/rewind, context reset, removal, or an input
binding change clears monitoring history. Ordinary parameter edits preserve it.
All counts, pending bangs, and readouts are runtime-only and absent from project
JSON. Labels, decimals, meter range, and flash duration are saved parameters.

## Troubleshooting recipes

- Open **Signal Test Lab** for Math → Map Range → Smooth → Signal Number,
  boolean edge detection, chained bangs, and a text readout.
- MIDI/Companion: map a controller to Constant.Value, then wire it to Signal
  Number. Branch through Control to Bool → Signal Edge → Trigger → Signal Bang
  to inspect held state separately from discrete events.
- JSON/network sources: Fetch/WebSocket/Server Events → Signal Text shows the
  payload; JSON Parse → JSON Select → JSON to Text → Text to Number → Signal
  Number inspects a selected scalar. Inspect remains available for structured
  JSON/table values.
- OSC: use the same typed monitoring paths once a gateway supplies values.
  These monitors do not implement or automatically start an OSC gateway.

No device permission is needed for the monitors themselves. Upstream device or
network sources still require their existing explicit start/connect actions.
The CPU schedule currently lives in the WebGL-backed preview runtime, so
no-Display monitoring still requires that runtime to initialize successfully.

The catalog advances to 20 with four additive kinds; project schema remains 1.
Compiler tests cover zero-pass demand roots and exact port types. Runtime and
browser tests cover numeric ranges, text, leading edges, duplicate events,
manual keyboard/click bangs, chaining, paused operation, and reset.