# tesla-mirror — design (v1)

Date: 2026-10-18

## Goal

Mirror an Android phone's screen into the Tesla Model 3 (2021+) web browser and
send touches from the Tesla screen back to the phone. A minimal Android Auto
analog: the phone runs Waze, Telegram, YouTube; the car shows and controls them.

## Scope (v1)

- Phone screen → Tesla browser video, ~150 ms latency over the phone's hotspot.
- Touch from Tesla → phone: tap, swipe, long press, two-finger pinch.
- Back / Home / Recents buttons on the page.
- Auto-reconnect on any link failure.
- Debug overlay on the page.

## Non-goals (v1)

- Audio and calls. Handled by Bluetooth: the phone is paired as the Tesla phone.
- Multiple simultaneous clients.
- Settings UI. Tunables are constants in code.
- Play Store distribution. APK is sideloaded.
- iOS. iOS has no public API to inject touches into other apps.

## Target environment

- Android 11+ (minSdk 30). Stock OS, no root.
- Dedicated in-car phone: always charging, mounted landscape, hotspot always on.
- Reference hardware for tuning constants: 2017-class SoC (Snapdragon 835),
  hardware H.264 encoder, 2880×1440 display.
- Tesla Model 3 2021+, Europe region (browser usable while driving), MCU2/MCU3
  Chromium-based browser.
- Car connects to the phone's hotspot. Everything runs on the LAN; no internet,
  no external server, no STUN/TURN.

## Architecture

```
 Tesla browser                           Android phone
 ┌───────────────────────┐   hotspot     ┌─────────────────────────────────┐
 │ index.html + app.js   │◄──── video ───│ PeerManager ◄── ScreenSource    │
 │  <video> (recvonly)   │               │     ▲                           │
 │  touch capture        │── WS /ws ────►│ WebServer ──► InputService      │
 │  Back/Home/Recents    │   signaling + │     ▲          (gestures)       │
 │  debug overlay        │   touch JSON  │ MirrorService (foreground)      │
 └───────────────────────┘               │ MainActivity + BootReceiver     │
                                         └─────────────────────────────────┘
```

### Phone (Kotlin)

| Component       | Responsibility |
|-----------------|----------------|
| `MirrorService` | Foreground service (`mediaProjection` type). Owns lifecycle of server, capture and peer. |
| `ScreenSource`  | Wraps libwebrtc `ScreenCapturerAndroid`; produces the video track from the MediaProjection grant. |
| `WebServer`     | HTTP on :8080 serving `assets/web/`; WebSocket at `/ws` for signaling, touch and state. One client at a time: a new WS closes the previous one. |
| `PeerManager`   | One `PeerConnection`, answers the browser's offer, exchanges ICE over WS. Host candidates only. |
| `InputService`  | `AccessibilityService`. Maps normalized touch snapshots to display pixels and dispatches gestures via `GestureStreamer`. Executes Back/Home/Recents via `performGlobalAction`. |
| `GestureStreamer` | Pure Kotlin, no Android framework dependencies. Turns successive finger snapshots into plain segment data that `InputService` converts to `StrokeDescription`s. Unit-tested. |
| `MainActivity`  | Status (server, capture, accessibility), `http://IP:8080`, Start button (MediaProjection consent), shortcut to accessibility settings. |
| `BootReceiver`  | Opens `MainActivity` after boot so only one tap (Start) is needed. |

### Browser (`assets/web/`, plain HTML/JS, ES modules, no build step)

- Opens WS, creates recvonly `RTCPeerConnection`, sends offer, applies answer and
  ICE, attaches stream to `<video autoplay muted playsinline>`.
- Fits video to the viewport preserving aspect ratio; letterbox as needed.
- Captures `touchstart/move/end/cancel` with `preventDefault`, `touch-action: none`,
  `user-scalable=no`. Normalizes coordinates to 0..1 relative to the rendered
  video box. Coalesces moves to one message per animation frame.
- Side panel: Back, Home, Recents, debug toggle.
- Debug overlay: WS state, ICE state, fps, bitrate (`getStats`), last touch events.

## Protocol (WebSocket, JSON, one object per message)

Browser → phone:

```json
{"t":"offer","sdp":"..."}
{"t":"ice","candidate":{...}}
{"t":"touch","pts":[{"id":0,"x":0.42,"y":0.71},{"id":1,"x":0.58,"y":0.33}]}
{"t":"key","k":"back"}            // back | home | recents
```

Phone → browser:

```json
{"t":"state","capturing":true,"accessibility":true,"capture":{"w":1440,"h":720}}
{"t":"answer","sdp":"..."}
{"t":"ice","candidate":{...}}
```

`touch.pts` is a snapshot of all active fingers; an empty list means all up.
`state` is sent on connect and on every change. `capture` is the captured frame size; the page only uses its aspect ratio.

## Gestures

- `InputService` multiplies normalized coordinates by the current real display
  size (rotation-aware). Capture includes the status bar and is already rotated,
  so the mapping is 1:1.
- `GestureStreamer` ticks every ~20 ms. For each active finger it emits a stroke
  segment from the previous point to the current one with `willContinue=true`,
  using `continueStroke` after the first segment. A finger that did not move
  gets a zero-length segment, which makes holding turn into a long press
  naturally. All fingers go into one `GestureDescription`, so two fingers form a
  pinch.
- Finger up: final segment with `willContinue=false`.
- Down and up within one tick: a single short stroke at the point (tap).
- A stroke is split before the 60 s system limit on gesture duration.
- If no touch snapshot arrives for 500 ms while fingers are down, all fingers
  are released.

## Startup and recovery

- Boot → `BootReceiver` → `MainActivity` → `MirrorService` starts; server is up
  before capture. The page shows "Tap Start on phone" until capture starts.
- Start → MediaProjection consent → capture runs; the page picks up video
  without reload.
- The screen stays on via developer option "Stay awake while charging".
  Hotspot auto-off is disabled in system settings.
- Whoever detects a failure reconnects:
  - WS dropped: browser reconnects with 1–5 s backoff and re-offers.
  - Peer `failed`/`disconnected`: browser tears down and reconnects WS.
  - Capture stopped: server stays up, page shows the hint, video resumes after Start.
  - Accessibility off: page shows a badge; video works, touches are ignored.

## Performance constants (reference hardware)

| Constant   | Value         |
|------------|---------------|
| Capture    | half scale, 1440×720 |
| Frame rate | 30 fps        |
| Max bitrate| 4 Mbit/s      |
| Codec      | H.264 (hardware encoder) |

## Risks and fallbacks

| Risk | Mitigation |
|------|------------|
| Tesla browser does not play WebRTC | Video transport is isolated behind `ScreenSource`/`PeerManager`. Plan B: MJPEG over the same WebSocket; everything else unchanged. |
| Tesla browser reports multi-touch incorrectly | Debug overlay shows raw events. Fallback: a dedicated zoom mode on the side panel. |
| Browser blocked while driving on this firmware | Verify in the car before investing in UX. |
| Thermal/battery load on old hardware | Half-scale capture, bitrate cap, phone always charging. |

## Development loop (no car, no phone)

- Android emulator, API 30 image, replaces the phone. MediaProjection,
  AccessibilityService and the embedded server all work there; the encoder is
  software, which is fine for development.
- `adb forward tcp:8080 tcp:8080`; desktop Chrome at `http://localhost:8080`
  replaces the Tesla browser. DevTools device mode gives touch and pinch
  (Shift + drag).
- Dev mode: the server can serve `assets/web/` from a folder on the device so
  the web part can be pushed via adb without rebuilding the APK.

## Testing

- Kotlin unit tests (JUnit): coordinate mapping with rotation, snapshot → stroke
  segments in `GestureStreamer`, message parsing.
- JS tests (`node --test`): coordinate normalization with letterbox, touch
  coalescing. Same ES modules run in browser and node.
- Integration on the laptop: emulator + adb forward + Chrome, manual checklist in
  `docs/testing.md`. A small Node script connects to `/ws` and sends a synthetic
  tap at a known point to verify injection on the emulator.
- Car checklist in `docs/car-checklist.md`: one trip, everything to set up and
  observe, logs collected afterwards via adb.

## One-time device setup

1. Install APK (`adb install` or open the file).
2. Enable the app's accessibility service.
3. Allow autostart / disable battery optimization for the app.
4. Developer options → "Stay awake while charging".
5. Hotspot on; disable "Turn off hotspot automatically".
6. Pair the phone with the Tesla over Bluetooth (audio and calls).
7. In the Tesla browser open `http://<hotspot IP>:8080` and bookmark it.
