# Events, transitions, and sequencing

This document describes the implemented graph-node foundation, not full show
playback or recording. The node registry owns parameter defaults, ranges,
select options, and indexed port order. All sixteen nodes run on the existing
CPU control schedule and add no GPU passes or device permissions.

## Signals and nodes

`control.bool` is sustained true/false state. `event.trigger` is a bounded batch
of occurrences with an ID, visual-transport timestamp in seconds, and sequence.
Neither implicitly connects to `control.f32`. Existing controller actions and
Audio Trigger outputs keep their original scalar contracts.

| Nodes | Behavior |
| --- | --- |
| Control to Bool / Bool to Control | Explicit scalar threshold and boolean low/high conversion |
| Compare | Equal/not-equal with tolerance, greater/less, or inclusive normalized min/max range |
| Logic | AND, OR, XOR, NOT on boolean inputs |
| Trigger | Rising, falling, or both boolean edges; first evaluation seeds state without firing |
| Event to Control | Nonempty batch starts a scalar pulse for the saved duration; useful for legacy scalar-trigger inputs |
| Gate | Boolean-selected open/closed scalar and event forwarding while open |
| Hold / Latch | Tracks a scalar while open, retains it while closed; reset restores Initial |
| Sample & Hold | Captures the scalar sampled in the current visual tick when a sample event arrives |
| Counter | Ordered increment/decrement/reset, bounded wrap or clamp; reset wins equal-time conflicts |
| Random | Repeatable seed/index hash sampled on events; reset restarts the sequence |
| Timer | Start/cancel, normalized progress, active state, started/done events, repeat, pause, and restart/ignore retrigger |
| Envelope | Attack/hold/release toward Peak and Initial, explicit release/cancel, pause, and completion event |
| Timed Transition | Interpolates from current value to Target; reverse heads toward Initial, cancel holds, and restart/ignore is explicit |
| Step Sequencer | Eight saved scalar steps, inclusive First/Last loop range, seconds or beats/BPM, running/reset, index, phase, and step events |
| Cue Scheduler | At most 256 ordered timestamped value cues, cue events, dropped count, and explicit live scalar override |

Optional inputs use saved literals where present, otherwise false, zero, or an
empty event batch. Connected scalar values clamp to their declared bounds;
connected booleans override the saved checkbox. Events do not change saved
parameters. State survives parameter edits and position-only graph edits;
rewiring a node resets its event state. Changing a cue list or random seed
also resets that node's event state.

## Timing, ordering, and limits

All nodes use the existing visual transport clock, not independent timers or
wall-clock callbacks. Pausing transport freezes elapsed time; explicit input
changes during held redraws may still produce edges. Per-node Paused/Running
inputs freeze elapsed progression without accumulating catch-up time.

Return to frame zero clears retained state. A backwards time jump reinitializes
at the new time; this is not historical state reconstruction or show seeking.
Removing a node from the active plan discards its state. Context restoration
reinitializes event state along with the rest of the runtime.

Input batches are ordered by time, input priority, sequence, and ID. Port
priority resolves same-time command conflicts: reset after sample/count,
cancel after start/reverse/release. Event identity deduplication is bounded to
4096 remembered port/ID pairs per node. Identical IDs within that window are
consumed once, including repeated renders at the same time. This is not
durable network exactly-once delivery.

At most 64 input actions and 64 occurrences per output batch are processed in
one visual tick. Timer, Step Sequencer, and Cue Scheduler expose Dropped for
their generated catch-up events. Late ticks retain the newest bounded events
and advance scalar state to the current position; they do not drain an unbounded
queue. Trigger edges cannot recover changes never sampled by the visual clock.
Sample & Hold and transition targets use the tick's resolved scalar input,
not a historical scalar value for each event in a batch.

Zero-duration Timer/Timed Transition completes once per accepted start; a
zero-duration repeating Timer does not spin. Duration is captured at start.
Transition restart begins from the current value, and reverse always targets
Initial rather than swapping arbitrary endpoints. Envelope handles finite
attack/hold/release stages across a late tick. Curves are linear, smooth,
ease-in, or ease-out. Step tempo changes preserve normalized phase and apply
the current tempo to the elapsed visual tick.

## Cue Scheduler format

```json
[
  {"id":"open","at":0,"value":0},
  {"id":"rise","at":1000,"value":1},
  {"id":"close","at":3000,"value":0}
]
```

`at` is an integer millisecond offset from this node's reset, from 0 to
86,400,000. Values are finite and bounded to +/-1,000,000. IDs are unique
1..64-character letters/digits/underscore/hyphen strings. Equal-time cues retain
array order, with the last value winning. The 16 KiB JSON list is validated
before parameter edits/imports enter project state. The scheduler does not loop.

Override enabled replaces only the scalar output. The underlying cue clock
and events continue; disabling override resumes the current scheduled value.
This is not arbitrary command dispatch: no patch replacement, recording,
output-layout activation, device I/O, or permissions are performed. Those remain
in [Planned Development](PLANNED_DEVELOPMENT.md).

## Teaching and integration

- **Cue Logic Basics:** a slow oscillator drives comparison, boolean logic,
  edge detection, gated events, counting, random sampling, and held color values.
- **Timed Transition:** Cue Scheduler starts an eased Crossfade and Timer;
  timer completion starts an Envelope driving Blur. Crossfade remains the
  existing stateless frame interpolator.
- **Step Sequence Lab:** four saved values choose Frame Switch sources;
  step events become a visible scalar pulse through Event to Control.

To adapt Audio Trigger, a MIDI-controlled scalar, or a controller-set numeric
parameter, use Control to Bool then Trigger. To drive legacy scalar event
inputs, use Event to Control; choose a pulse length that lets the destination
observe low between triggers. Full controller-to-event injection is not implied.

These additions advance the operator catalog to 19; project schema remains 1.
Old projects are unchanged, while older applications reject unknown kinds.
Tests cover typed-wire rejection, serialization, duplicate events, zero duration,
interruption/reversal, pause/reset, tempo changes, late ticks, and cue override.
Browser tests exercise cue-driven frame interpolation and reset plus all three
teaching patches. Deployment and physical-controller tests are separate.