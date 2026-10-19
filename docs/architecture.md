# Architecture

One page, one protocol, two phone apps. The phone shows its screen in the Tesla
browser over its own hotspot; nothing leaves the LAN.

| | Android | iPhone |
|--|---------|--------|
| Video | H.264 over WebRTC | H.264 Annex B in WebSocket binary frames, muxed to fMP4 in the page, played via MSE |
| Touch from the Tesla | yes, AccessibilityService gestures | no (iOS has no injection API) |
| Capture | MediaProjection, foreground service | ReplayKit Broadcast Upload Extension |
| Server | Ktor inside the app | Telegraph inside the extension |
| `state` fields | `transport: webrtc`, `touch: true` | `transport: h264ws`, `touch: false` |
| Details | [android.md](android.md) | [ios.md](ios.md) |

```
 Tesla browser (web/public)         phone (hotspot)
 ┌───────────────────────┐          ┌──────────────────────────────┐
 │ page: WS /ws          │◄─ state ─│ web server :8080             │
 │  webrtc: <video>      │◄─ video ─│  Android: WebRTC track       │
 │  h264ws: MSE <video>  │◄─ frames │  iPhone: binary WS frames    │
 │ touch (Android only)  │─ touch ─►│  Android: InputService       │
 └───────────────────────┘          └──────────────────────────────┘
```

The phone serves the page (`web/public/`, bundled into both apps) and the
WebSocket on port 8080. Messages and the binary frame header:
[protocol.md](protocol.md). Why iOS uses H.264 over WebSocket:
[decision](decisions/2026-10-19-ios-h264-over-websocket.md).

## Browser page (`web/public/`)

| File | Responsibility |
|------|----------------|
| `index.html` | Two video elements (`#video` for WebRTC, `#stream` for H.264, one shown at a time), side panel, debug overlay. `user-scalable=no`. |
| `style.css` | Full-viewport black layout, `touch-action: none`, side panel, debug overlay. Tesla-like look from tokens on `:root`; plain kebab-case classes (no BEM), ids are JS hooks only and never styled, no tag selectors. |
| `app.js` | Entry: wires WS, peer, touch, panel. |
| `ws.js` | WebSocket with 1–5 s reconnect backoff; sends/receives protocol messages; binary messages go to `onBinary`. |
| `peer.js` | recvonly `RTCPeerConnection`; offer → answer → ICE; tears down and reconnects on `failed`/`disconnected`. |
| `touch.js` | Pure helpers: video box, normalization to it (letterbox-aware; touches that start outside the box or on the side panel are ignored for their whole lifetime, others are clamped to the box), per-frame coalescing. Page re-sends the latest snapshot every 100 ms while a finger is down. |
| `caps.js` | Pure. `transportOf(state)` → `{transport, touch}`; missing fields mean `webrtc` / `true` (older Android builds). |
| `frame.js` | Pure. `parseFrame` for the 16-byte binary header, `createKeyGate` (start only on a keyframe, re-arm when more than 15 media segments wait for the SourceBuffer). |
| `fmp4.js` | Pure. Annex B → NAL split, codec string from the SPS, fragmented-MP4 init and media segment boxes. |
| `h264.js` | `h264ws` playback: parse frames, gate on keyframes, mux to fMP4 and append to a MediaSource on `#stream`; stays near the live edge, trims old buffer, rebuilds on SPS change or append error. `h264Supported()` checks `MediaSource.isTypeSupported`. |
| `debug.js` | WS/ICE state, fps, bitrate from `getStats`, last touch events. |
| `types.js` | JSDoc typedefs shared by the modules (messages, touch point, video box). |

The `state` message picks the transport. `webrtc` (Android) plays the `<video>`
track as above. `h264ws` (iOS) shows `#stream` instead, sends no `offer`, and
plays the binary frames from the socket through Media Source Extensions, muxing
them to fragmented MP4 in the page. WebCodecs is not used: it exists only in
secure contexts and the page is plain http on a LAN address. `touch: false` makes the page
ignore touches and hide the Back/Home/Recents buttons and the accessibility
badge; the debug button stays. See [protocol.md](protocol.md).

## Transports

The `state` message picks the transport, so adding one touches the phone and
`app.js` only. WebRTC (Android) is isolated behind `ScreenSource` +
`PeerManager`; if the Tesla browser cannot play it, plan B is MJPEG over the
same WebSocket. For iOS, the fallback if MSE is too slow is WebRTC inside the
extension, reusing `peer.js`.

## Orientation, input, recovery

Platform-specific; see [android.md](android.md) (gesture model, force
landscape, startup) and [ios.md](ios.md) (broadcast lifecycle, rotation).
Common rule: whoever detects a failure reconnects; the page retries the
WebSocket with 1-5 s backoff and starts over from `state`.

Out of scope: audio and calls (Bluetooth, phone paired as the Tesla phone),
multiple clients, settings UI, touch on iOS.
