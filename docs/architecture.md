# Architecture

Phone screen → H.264 over WebRTC → Tesla browser. Touches from the browser →
JSON over WebSocket → gestures injected via AccessibilityService. The phone's
hotspot is the only network; nothing leaves the LAN.

```
 Tesla browser (web/public)              Android phone (android/app/)
 ┌───────────────────────┐   hotspot     ┌─────────────────────────────────┐
 │ <video> recvonly      │◄──── video ───│ PeerManager ◄── ScreenSource    │
 │ touch capture         │── WS /ws ────►│ WebServer ──► InputService      │
 │ Back/Home/Recents     │   signaling + │     ▲          GestureStreamer  │
 │ debug overlay         │   touch JSON  │ MirrorService (foreground)      │
 └───────────────────────┘               │ MainActivity + BootReceiver     │
                                         └─────────────────────────────────┘
```

## Phone components (`android/app/src/main/java/app/teslamirror/`)

| Component | File | Responsibility |
|-----------|------|----------------|
| MirrorService | `MirrorService.kt` | Foreground service (`specialUse` while serving, `mediaProjection` while capturing; stopping capture returns it to serving). Starts the server on boot/app open; starts/stops capture and peer on a single worker thread; publishes `MirrorState` and pushes `state` to the page; releases all fingers when the page disconnects. |
| ScreenSource | `video/ScreenSource.kt` | Wraps libwebrtc `ScreenCapturerAndroid`; video track from the MediaProjection grant. Half-scale capture, 30 fps, 4 Mbit/s cap. |
| PeerManager | `video/PeerManager.kt` | One `PeerConnection`, answers the browser's offer, relays ICE over WS. Host candidates over UDP only (TCP candidates disabled), no STUN/TURN. |
| WebServer | `net/WebServer.kt` | HTTP :8080 serving `web/public` from classpath resources (`public/**`), or from the dev folder when present (read once at start, see [development.md](development.md)); WebSocket `/ws`. One client: a new connection closes the previous one. |
| InputService | `input/InputService.kt` | `AccessibilityService`. Normalized touch → display pixels (rotation-aware) → `dispatchGesture`; at most `getMaxStrokeCount()` fingers (lowest ids). Back/Home/Recents via `performGlobalAction`. |
| GestureStreamer | `input/GestureStreamer.kt` | Pure Kotlin. Finger snapshots → stroke segments of 20 ms, clocked by dispatch completion, `continueStroke` for ongoing fingers. Unit-tested. |
| StrokePlanner | `input/StrokePlanner.kt` | Pure Kotlin. Turns a segment plus the previous actual end into the stroke to dispatch (start point, hold nudge). Unit-tested. |
| MainActivity | `MainActivity.kt` | Status (collects `MirrorState`), server URL or "hotspot off", Start (MediaProjection consent), Stop, link to accessibility settings, Force landscape switch (`OrientationLock`). |
| BootReceiver | `BootReceiver.kt` | Starts MirrorService after boot; its notification opens MainActivity ([decision](decisions/2026-10-18-boot-starts-service.md)). |

Video transport is isolated behind `ScreenSource` + `PeerManager`. If the Tesla
browser cannot play WebRTC, plan B is MJPEG over the same WebSocket with
everything else unchanged.

## Browser page (`web/public/`)

| File | Responsibility |
|------|----------------|
| `index.html` | Two video elements (`#video` for WebRTC, `#stream` for H.264, one shown at a time), side panel, debug overlay. `user-scalable=no`. |
| `style.css` | Full-viewport black layout, `touch-action: none`, side panel, debug overlay. Tesla-like look from tokens on `:root`; plain kebab-case classes (no BEM), ids are JS hooks only and never styled, no tag selectors. |
| `app.js` | Entry: wires WS, peer, touch, panel. |
| `ws.js` | WebSocket with 1–5 s reconnect backoff; sends/receives protocol messages; binary messages go to `onBinary`. |
| `peer.js` | recvonly `RTCPeerConnection`; offer → answer → ICE; tears down and reconnects on `failed`/`disconnected`. |
| `touch.js` | Pure helpers: video box, normalization to it (letterbox-aware; touches that start outside the box or on the side panel are ignored for their whole lifetime, others are clamped to the box), per-frame coalescing. Page re-sends the latest snapshot every 100 ms while a finger is down. |
| `caps.js` | Pure. `transportOf(state)` → `{transport, touch}`; missing fields mean `webrtc` / `true` (older Android phones). |
| `frame.js` | Pure. `parseFrame` for the 16-byte binary header, `createKeyGate` (start only on a keyframe, re-arm on decoder backlog). |
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

## Gesture model

`InputService` keeps the current set of fingers from the latest `touch`
snapshot. `GestureStreamer` emits 20 ms segments, clocked by dispatch
completion: per finger, a segment from its previous point to the current one
with `willContinue=true`. A finger that did not move gets a zero-length
segment, so holding becomes a long press.
All fingers go into one `GestureDescription`, so two fingers form a pinch.
Finger up → final segment with `willContinue=false`. Down and up within one
tick → a single short stroke (tap). Strokes are split before the 60 s system
limit. If no snapshot arrives for 500 ms while fingers are down, all fingers
are released. If Android cancels a dispatched gesture, the strokes restart as
new ones from each finger's current point (continuing a cancelled stroke would
be cancelled again at once). An id released and pressed again between two
dispatches ends its old stroke and starts a new one: the release and the new
press go out in one gesture, overlapping for 20 ms.
`InputService` (via `StrokePlanner`) nudges a held (zero-length) continued
segment by half a pixel because the framework cancels continued strokes that do
not move, and it starts each continuation exactly where the previous segment
ended.

The page shows "Waiting for first frame" from peer start until the video
element reports its first frame; a static phone screen emits no frames.

Coordinates: capture includes the status bar and is already rotated, so
normalized `x,y` × real display size is a 1:1 mapping.

## Orientation

The phone can lie anywhere. The "Force landscape" switch in `MainActivity`
(`OrientationLock`, needs the "Modify system settings" permission) turns
auto-rotate off and sets the system user rotation to landscape, so every
landscape-capable app renders horizontally. Capture follows the logical
display, not the physical one: an app that supports landscape fills the view;
a portrait-only app appears as a tall image centered with black bars, and
touches still map 1:1.
On a display size change `ScreenSource` restarts capture with the new size,
`MirrorService` pushes a new `state`, and the page recomputes the video box
from the video element's `resize` event.

## Startup and recovery

- Boot → BootReceiver → MirrorService (serving). The notification opens
  MainActivity, where one tap on Start begins capture. The server is up before
  capture; the page shows "Tap Start on phone" until capture starts.
- The service re-reads the hotspot address every 10 s and the accessibility
  state every 2 s, and pushes `state` to the page on any change.
- Whoever detects a failure reconnects: WS drop → page reconnects and
  re-offers (page shows "Reconnecting…" meanwhile); peer failed → page reconnects WS; capture stopped → server stays
  up, page shows hint; accessibility off → page shows a "No touch" badge, touches ignored.
- Screen stays on via developer option "Stay awake while charging"; hotspot
  auto-off is disabled. See [device-setup.md](device-setup.md).

Out of scope: audio and calls (Bluetooth, phone paired as the Tesla phone),
multiple clients, settings UI, iOS (no touch injection API).
