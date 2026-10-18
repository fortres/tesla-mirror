# Architecture

Phone screen → H.264 over WebRTC → Tesla browser. Touches from the browser →
JSON over WebSocket → gestures injected via AccessibilityService. The phone's
hotspot is the only network; nothing leaves the LAN.

```
 Tesla browser (web/public)              Android phone (app/)
 ┌───────────────────────┐   hotspot     ┌─────────────────────────────────┐
 │ <video> recvonly      │◄──── video ───│ PeerManager ◄── ScreenSource    │
 │ touch capture         │── WS /ws ────►│ WebServer ──► InputService      │
 │ Back/Home/Recents     │   signaling + │     ▲          GestureStreamer  │
 │ debug overlay         │   touch JSON  │ MirrorService (foreground)      │
 └───────────────────────┘               │ MainActivity + BootReceiver     │
                                         └─────────────────────────────────┘
```

## Phone components (`app/src/main/java/com/fortres/teslamirror/`)

| Component | File | Responsibility |
|-----------|------|----------------|
| MirrorService | `MirrorService.kt` | Foreground service (`mediaProjection` type). Starts/stops server, capture, peer. |
| ScreenSource | `video/ScreenSource.kt` | Wraps libwebrtc `ScreenCapturerAndroid`; video track from the MediaProjection grant. Half-scale capture, 30 fps, 4 Mbit/s cap. |
| PeerManager | `video/PeerManager.kt` | One `PeerConnection`, answers the browser's offer, relays ICE over WS. Host candidates only, no STUN/TURN. |
| WebServer | `net/WebServer.kt` | HTTP :8080 serving `web/public` from classpath resources (`public/**`); WebSocket `/ws`. One client: a new connection closes the previous one. |
| InputService | `input/InputService.kt` | `AccessibilityService`. Normalized touch → display pixels (rotation-aware) → `dispatchGesture`. Back/Home/Recents via `performGlobalAction`. |
| GestureStreamer | `input/GestureStreamer.kt` | Pure Kotlin. Finger snapshots → stroke segments every ~20 ms, `continueStroke` for ongoing fingers. Unit-tested. |
| MainActivity | `MainActivity.kt` | Status, server URL, Start (MediaProjection consent), link to accessibility settings. |
| BootReceiver | `BootReceiver.kt` | Opens MainActivity after boot so one tap on Start is all that is needed. |

Video transport is isolated behind `ScreenSource` + `PeerManager`. If the Tesla
browser cannot play WebRTC, plan B is MJPEG over the same WebSocket with
everything else unchanged.

## Browser page (`web/public/`)

| File | Responsibility |
|------|----------------|
| `index.html` | Video element, side panel, debug overlay. `user-scalable=no`. |
| `style.css` | Full-viewport black layout, `touch-action: none`, side panel, debug overlay. |
| `app.js` | Entry: wires WS, peer, touch, panel. |
| `ws.js` | WebSocket with 1–5 s reconnect backoff; sends/receives protocol messages. |
| `peer.js` | recvonly `RTCPeerConnection`; offer → answer → ICE; tears down and reconnects on `failed`/`disconnected`. |
| `touch.js` | Pure helpers: video box, normalization to it (letterbox-aware; touches that start outside the box or on the side panel are ignored for their whole lifetime, others are clamped to the box), per-frame coalescing. Page re-sends the latest snapshot every 100 ms while a finger is down. |
| `debug.js` | WS/ICE state, fps, bitrate from `getStats`, last touch events. |

## Gesture model

`InputService` keeps the current set of fingers from the latest `touch`
snapshot. `GestureStreamer` ticks every ~20 ms and emits, per finger, a segment
from its previous point to the current one with `willContinue=true`. A finger
that did not move gets a zero-length segment, so holding becomes a long press.
All fingers go into one `GestureDescription`, so two fingers form a pinch.
Finger up → final segment with `willContinue=false`. Down and up within one
tick → a single short stroke (tap). Strokes are split before the 60 s system
limit. If no snapshot arrives for 500 ms while fingers are down, all fingers
are released.

Coordinates: capture includes the status bar and is already rotated, so
normalized `x,y` × real display size is a 1:1 mapping.

## Orientation

The phone is mounted landscape with system auto-rotate on. Capture follows the
logical display, not the physical one, so the picture on the Tesla is always
upright: an app that supports landscape fills the view; a portrait-only app
appears as a tall image centered with black bars, and touches still map 1:1.
On a display size change `ScreenSource` restarts capture with the new size,
`MirrorService` pushes a new `state`, and the page recomputes the video box
from the video element's `resize` event.

## Startup and recovery

- Boot → BootReceiver → MainActivity → MirrorService. Server is up before
  capture; the page shows "Tap Start on phone" until capture starts.
- Whoever detects a failure reconnects: WS drop → page reconnects and
  re-offers; peer failed → page reconnects WS; capture stopped → server stays
  up, page shows hint; accessibility off → page shows badge, touches ignored.
- Screen stays on via developer option "Stay awake while charging"; hotspot
  auto-off is disabled. See [device-setup.md](device-setup.md).

Out of scope: audio and calls (Bluetooth, phone paired as the Tesla phone),
multiple clients, settings UI, iOS (no touch injection API).
