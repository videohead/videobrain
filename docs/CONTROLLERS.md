# MIDI and Stream Deck control

Open **Controllers** from the toolbar. This is a controller-mapping surface,
not a new graph node or a general remote graph-editing API.

## Supported actions

- Parameter: absolute numeric value, set on press, toggle between two values,
  or momentary high/on while held. Boolean and select parameters support button
  modes; text, credentials, device start, and asset selection are excluded.
- Frame source: select A/B/C/D or advance with wrap on Frame Switch or Source
  Selector. Disconnect a patched Index/Trigger input before using a mapping.
- Transport: play, pause, play/pause toggle, or return to frame zero. This is
  visual transport, not a command to start microphones, cameras, or audio output.

Save a short stable mapping ID, such as `mix`, `next-source`, or `pause`.
Targets are existing node IDs and registry parameter IDs. Values use the
parameter's actual units and bounds. Absolute input is normalized to 0..1,
scaled between Low/off and High/on (which may be reversed), and snapped to the
parameter step. Absolute control has immediate takeover, not pickup.
Graph-bound parameters reject controller edits rather than silently changing
an overridden literal.

Mappings are versioned browser-local settings, capped at 128, separate from
exported project JSON. MIDI device IDs stay in that browser's mapping settings;
keys never enter saved mappings. Reload starts disarmed with MIDI and Companion
disconnected. Replacing or structurally changing a graph disarms mappings; stale
targets are rejected. Re-learn a device if its browser ID changes.

Arm explicitly after setup. Disarm, disconnect, or leaving the browser window
releases held parameters; focus loss also disarms controls. Keep the studio
window focused during performance. Holds have a ten-second safety timeout and
must receive a release before another press. A release restores the pre-press
value only if it has not been changed meanwhile. Parameter changes use normal
project persistence and undo; MIDI CC changes are coalesced at about 30 Hz with
a 250 ms idle boundary for undo. No parameter automation track is recorded.

## MIDI and Stream Deck MIDI plugins

1. Use an HTTPS browser supporting [Web MIDI](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API).
   Chrome/Edge are suitable desktop choices. Safari and iOS Safari do not
   support Web MIDI; consult MDN for current platform support.
2. Connect a MIDI controller, or configure a Stream Deck MIDI plugin to send
   notes/CC into an OS virtual MIDI port visible to the browser. Installing or
   configuring that third-party plugin is separate from VideoBrain.
3. Select **Enable MIDI** and grant the browser permission. No SysEx permission
   is requested. Device names appear only after access is granted.
4. Save a mapping, press its **Learn** button, then move a CC control or press
   a note. Learn records the exact device, channel (1..16), type, and number.
   For an absolute parameter use CC; for buttons use notes or a CC sending
   127 on press and 0 on release. Learning disarms control dispatch.
5. Arm, then operate the controller. Note-off and velocity-zero note-on both
   release. CC values below 64 release button mappings; 64..127 press them.

This input-only implementation does not send MIDI feedback, clock, program
changes, pitch bend, NRPN, 14-bit CC, relative encoder messages, or SysEx.
A Stream Deck is not itself a Web MIDI device without the plugin/virtual-port
route. For native Stream Deck button operation, use Companion below.

Web MIDI requires a secure context and user permission. A restrictive
`Permissions-Policy: midi=()` header blocks it even if the user wants to allow
access. Configure the HTTPS proxy with `Permissions-Policy: midi=(self)` when
using a policy; embedded deployments also need the appropriate iframe policy.
Disabling MIDI closes input ports but does not revoke the browser permission;
revoke that through browser site settings.

## Bitfocus Companion bridge

Use Companion's generic HTTP request actions to control saved mapping IDs.
No custom Stream Deck plugin or dedicated Companion module is required.
The optional control service forwards commands to one authenticated studio tab.

The service uses `VIDEOBRAIN_CONTROL_API_KEY` and
`VIDEOBRAIN_CONTROL_ALLOWED_ORIGINS` in `docker-compose.control.yml`.
Set the key privately in your environment and set the origins to the exact
browser origins, comma-separated, without URL paths. The compose default
publishes port 8933 on server loopback only. Build/start it with:

```sh
docker compose -f docker-compose.control.yml up -d --build videobrain-control
```

For a remote browser, configure an HTTPS reverse proxy to forward WebSocket
upgrades on a chosen public route to `/control-ws` on `127.0.0.1:8933`. Enter
that `wss://` URL in Controllers and enter the same key in the password field.
Do not put keys in URLs. The key is sent in the first WebSocket message and
remains in memory only. Configure CSP `connect-src` to allow that destination.
The reverse proxy's origin policy must not block the configured studio origin.

If the control service runs on the browser's machine, a loopback
`ws://127.0.0.1:8933/control-ws` URL is accepted; browser mixed-content/local
network policy can still require WSS. Never send a key over remote plain WS or
HTTP. Companion running on another machine must reach an HTTPS-protected API
route, not the server's private loopback address.

In Companion, configure an HTTP POST action targeting `/api/control` on the
control service, with headers:

```text
Content-Type: application/json
X-Api-Key: <your privately configured key>
```

Button press body:

```json
{"requestId":"press-unique-001","mappingId":"next-source","event":{"type":"press"}}
```

Button release body:

```json
{"requestId":"release-unique-002","mappingId":"next-source","event":{"type":"release"}}
```

For an absolute parameter:

```json
{"requestId":"value-unique-003","mappingId":"mix","event":{"type":"value","value":0.75}}
```

Use a Companion variable/expression providing a fresh unique request ID for
each new event, including releases. IDs allow letters, digits, `_`, and `-`,
up to 64 characters. The examples are placeholders, not IDs to reuse for each
press. Preserve the same ID and body only when retrying the same event.
Always configure a release action, including for toggle and transport buttons.
Repeated presses without release are suppressed until release or safety timeout.

The API returns the browser's acknowledgement: 200 for accepted commands,
400 for invalid input, 401 for authentication failure, 409 for conflicting ID
reuse, 422 for browser rejection/timeout, 429 for limits, and 503 for no tab.
An acknowledgement is not confirmation that a frame reached a physical display.
`GET /api/control/status` with the same key reports tab connection state.
Limits: 4 KiB messages, 60 HTTP commands/second, 128 pending commands, and a
bounded 60-second request-ID cache. Deduplication is not durable across service
restarts. On timeout, do not generate a new ID to blindly replay a trigger.
Only one authenticated controller tab is allowed. Connection loss releases
holds; a heartbeat detects stale browser connections.

The older whole-project `/ws` bridge is disabled by default. Enabling
`CONTROL_ENABLE_LEGACY_GRAPH_BRIDGE=true` restores that legacy behavior and is
not required for MIDI or Companion. Do not expose the legacy bridge publicly.

## Verification and limits

Automated tests use synthetic MIDI input and a simulated Companion connection,
plus real local HTTP/WebSocket relay tests. Physical controllers, Stream Deck
plugins, and a live Companion installation still require device testing.
The implementation does not launch patches, start device sessions, create graph
nodes, expose arbitrary scripts, or add general `event.trigger` graph wires.