# VideoBrain Model Connectors

Status: current browser connector contract and adapter guidance for the Video Model node.

## What ships today

The Signal Graph includes two model-facing nodes:

- **AI Chat** stores a positive prompt and an optional negative prompt, then emits `text.utf8`.
- **Video Model** accepts that text, optionally accepts a frame source, and emits `frame.rgba`.

Video Model has three runtime choices:

| Runtime | Current behavior |
| --- | --- |
| Preview | Uses a built-in procedural GPU effect. It makes the graph immediately demonstrable, but it is not model inference and makes no network request. |
| Local | Connects to a user-run compatible adapter, commonly on the same machine or LAN. |
| API | Connects to a compatible HTTPS or secure-WebSocket gateway operated by the user or a service. |

Local and API identify deployment intent; they do not add vendor-specific protocol support. An arbitrary model endpoint will not work merely because its URL is entered in the node. A small adapter must translate between the generic VideoBrain contract and the chosen runtime or service.

## Graph contract

| Port or setting | Type | Meaning |
| --- | --- | --- |
| `prompt` | `text.utf8` | Required text from AI Chat |
| `source` | `frame.rgba` | Optional visual source. Preview mode can transform any upstream frame. Current network transport sends pixels only when this is a directly connected Video Input using WebSocket. |
| `frame` | `frame.rgba` | Latest generated frame, or the safe built-in preview/fallback |
| Runtime | select | Preview, Local, or API |
| Transport | select | WebSocket stream or HTTP request/response |
| Endpoint | text | Adapter URL; saved in the graph |
| Model | text | Adapter-defined model or workflow identifier |
| Strength, guidance, seed | numeric | Portable creative hints whose exact interpretation belongs to the adapter |
| Input FPS | numeric | Requested camera-upload cadence in WebSocket mode, from 1 to 30 fps |

The renderer consumes only the latest successfully decoded generated image. Network connections, requests, credentials, image elements, object URLs, and frame queues are session/runtime state and are never serialized into the project.

## `videobrain.frames.v1`

Both transports use the protocol identifier `videobrain.frames.v1`. A client request has this shape:

```json
{
  "type": "configure",
  "protocol": "videobrain.frames.v1",
  "nodeId": "model-1",
  "model": "realtime-video",
  "prompt": "A luminous living landscape",
  "negativePrompt": "flicker, watermark",
  "settings": {
    "strength": 0.7,
    "guidance": 1.2,
    "seed": 42,
    "inputFps": 12
  },
  "input": {
    "type": "jpeg",
    "delivery": "binary-websocket-message"
  },
  "auth": {
    "type": "bearer",
    "token": "session-only-token"
  }
}
```

`type` is either `configure` or `generate`. `input` is present only when the graph directly connects Video Input to Video Model. It announces that subsequent binary WebSocket messages contain JPEG camera frames. `auth` is optional and is used only in WebSocket JSON messages; HTTP authentication uses the request header described below.

Adapters should reject unsupported protocol versions with a clear error. Fields beyond this version should be ignored only when doing so is safe. `nodeId` correlates browser nodes within a session; it is not an authorization boundary or a globally unique job identifier.

### WebSocket streaming

Use `ws://` or `wss://` with the WebSocket transport. The current sequence is:

Before starting, the Video Model must contribute to a path ending at Display.
Disconnected branches never open or retain network sessions.

1. The browser opens the socket and sends a `configure` JSON message.
2. Prompt or parameter edits send a debounced `configure` message when the effective configuration changes. A session key is sent only after the user presses **Apply**.
3. **Request frame** sends one `generate` JSON message. If the socket is not open yet, the request is sent once connection succeeds. Only one generation request can be outstanding; it clears on the next frame or adapter error and times out after 120 seconds.
4. When a directly connected camera is live, the browser may send binary JPEG messages after configuration. Images are scaled so their longest edge is at most 768 pixels, encoded at bounded quality, and paced by Input FPS.
5. The adapter returns each generated image as a binary image message or a supported JSON frame message. The newest decoded frame becomes the node output.

The browser skips camera input while an image is already being encoded or while socket backlog exceeds 4 MiB. Incoming responses use one active decode plus one replaceable latest-frame slot; a decode is cancelled after 15 seconds. Returned HTTP(S) image URLs are fetched without cookies or HTTP credentials, without a referrer, and without redirects. An adapter should likewise keep a bounded queue and prefer the newest live input rather than accumulating stale work.

The preferred WebSocket responses are:

- a binary JPEG, PNG, or other browser-decodable image;
- `{"type":"frame","image":"data:image/..."}`;
- `{"type":"frame","url":"https://..."}` where the URL permits browser CORS access;
- `{"type":"error","message":"Actionable explanation"}`.

For compatibility, the current client also recognizes string fields named `frame`, `url`, or `image_url`, plus `data[0].url`. Binary `ArrayBuffer` messages are interpreted as JPEG. Keep each returned frame at or below the limits in [Safety limits](#safety-limits).

### HTTP request/response

Use `http://` or `https://` with the HTTP transport, subject to the secure-transport rules below. **Generate** sends one `POST` request:

As with WebSocket mode, the node must contribute to a path ending at Display
before **Generate** can start network work.

- `Content-Type: application/json`;
- `Authorization: Bearer …` when a session key is present;
- a `generate` request using the same protocol, prompt, model, and settings fields.

The request omits ambient cookies and browser credentials, sends no referrer,
and rejects redirects so prompt data is not forwarded beyond the exact endpoint.
The response can be an image body or JSON containing one of the supported image
fields above. Requests time out after 120 seconds and a newer request cancels
the older one. HTTP mode does not currently upload source pixels; use a directly
connected Video Input with WebSocket mode, or a purpose-built future upload
contract, for live visual conditioning. Cross-origin adapters must explicitly
allow the application origin with CORS.

## Safety limits

The browser enforces these current bounds:

- 20 MiB maximum for a returned image body or binary frame;
- 2,048 pixels maximum on either decoded image dimension;
- 2,073,600 decoded pixels maximum;
- 768 pixels maximum on the longest edge of outbound camera JPEGs;
- 1–30 outbound camera frames per second;
- 4 MiB maximum WebSocket backlog before live input is dropped;
- one outstanding WebSocket generation request, with a 120-second timeout;
- one incoming decode plus one replaceable latest frame, with a 15-second decode timeout;
- 120-second HTTP request timeout, with one active request per node;
- `ws`/`wss` URLs for WebSocket and `http`/`https` URLs for HTTP;
- no username, password, or fragment embedded in endpoint URLs;
- HTTPS/WSS for API runtime and whenever a session key is present;
- plain HTTP/WS only for credential-free Local runtime on `localhost`, `127.0.0.1`, or `[::1]`; an HTTPS-hosted page rejects both plaintext transports.

Remote image URLs are fetched by the browser without cookies, HTTP credentials,
a referrer, or redirects and therefore need an appropriate CORS policy. A
generated image that fails type, byte, dimension, pixel-count, URL-scheme, or
decode checks never replaces the last good frame.

## Privacy and trust boundaries

- Preview mode stays inside the GPU renderer and sends nothing over the network.
- Camera and microphone permission remain explicit user actions. A camera is transmitted only while it is live, directly connected to a Video Model, and that node has an open compatible WebSocket.
- The endpoint URL, model identifier, prompt, and creative settings are project data. They are saved and exported.
- Session API keys are held only in memory, scoped to the endpoint for which they were entered, cleared when that endpoint changes, and excluded from autosave/export.
- Prompts, session keys, and transmitted frames are visible to the configured endpoint. Use only an adapter you trust.
- API mode and every session key require `wss://` or `https://`. Plain transport is accepted only for a credential-free Local adapter on the same machine, and the hosted HTTPS application rejects both `ws://` and `http://` model endpoints.
- A WebSocket adapter should validate the browser `Origin`, authenticate the user, cap rates and message sizes, and expose only the model operations it needs.
- Do not ship a long-lived upstream service key in the browser. Put provider credentials in a trusted gateway or local adapter and give the browser a narrow, revocable session credential.
- Disconnect is a runtime action: it closes the socket or aborts the request. Removing a Video Model node—or disconnecting it from every Display path—also releases its request, socket, queued decode, frame URL, and session state.
- Starting a new blank or example patch hard-resets all model sessions, including endpoint-scoped credentials and cached camera-upload canvases. Undo restores the graph only; it does not restart connections or restore credentials.

There is currently no end-to-end encryption beyond the selected HTTPS/WSS transport, no model sandbox supplied by the hosted app, and no claim that a remote service retains nothing. Adapter operators must document retention, moderation, licensing, provenance, and billing policy.

## Local adapter architecture

```text
Signal Graph
  -> compatible loopback adapter, or TLS-protected LAN adapter
  -> bounded newest-frame queue
  -> user-selected local model runtime or workflow
  -> browser-decodable image
  -> Video Model frame output
```

A local adapter should:

- implement the versioned request and response contract above;
- validate `Origin`, protocol version, node/session identity, and every field;
- map portable settings to the selected runtime without pretending they have identical semantics across models;
- downsample or drop stale conditioning frames before inference;
- normalize output to a bounded browser-decodable image;
- report warmup, missing model, out-of-memory, cancellation, and decode failures as actionable errors;
- bind to loopback by default and require explicit configuration before accepting LAN clients.

The adapter can be implemented in any language and can target any runtime, provided it exposes this contract. The browser does not install, launch, or grant trust to that process automatically.

## Hosted API gateway architecture

```text
Signal Graph
  -> authenticated HTTPS/WSS gateway
  -> authorization, quota, validation, and job control
  -> provider-specific API or managed model runtime
  -> normalized bounded image response/stream
  -> Video Model frame output
```

A gateway is the right place to keep provider secrets, translate request schemas, upload assets, poll asynchronous jobs, enforce quotas, cancel stale jobs, moderate content, and normalize provider output. It should issue short-lived browser credentials, restrict CORS and WebSocket origins, redact secrets from logs, and make cost/retention behavior visible.

Direct provider URLs are compatible only if that provider independently implements `videobrain.frames.v1` and the required browser security policy. Most existing APIs need an adapter.

## Future protocol directions

- Capability negotiation for image formats, maximum size, input modalities, and setting ranges.
- Request IDs, frame sequence numbers, timestamps, progress, cancellation, and explicit acknowledgements.
- A defined HTTP multipart or resumable upload path for source images and clips.
- `VideoFrame`/WebCodecs or WebRTC media paths for lower-overhead continuous video.
- Multiple conditioning inputs such as masks, depth, pose, audio features, and reference images.
- Worker-hosted in-browser models through WebGPU or WebAssembly when size and performance permit.
- Adapter conformance fixtures and a small SDK for request validation and response normalization.
- Provenance, model/version metadata, content credentials, license notes, and reproducible seed reporting.
- Fallback policies that retain a last safe frame, switch to the built-in preview, or bypass the node after a timeout.
- Explicit queue, latency, dropped-frame, warmup, and accelerator diagnostics in the monitor.

Protocol evolution must remain versioned and capability-driven. It must not weaken project validation, expose arbitrary code execution, or make a network service necessary for opening and editing a graph.
