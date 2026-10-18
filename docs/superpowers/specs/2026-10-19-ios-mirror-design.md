# tesla-mirror — iOS mirror design (view-only)

Date: 2026-10-19. Builds on the v1 design (`2026-10-18-tesla-mirror-design.md`).

## Goal

Show an iPhone's screen in the Tesla browser the same way the Android app does,
without touch injection (iOS has no API for it). The driver controls the phone
on the phone; the Tesla shows it. Android stays the primary, fully controllable
target; iOS is an additional, view-only one. One repository, one page, one
protocol.

## Scope

- iOS app + Broadcast Upload Extension that captures the whole screen and
  serves the mirror page over the phone's Personal Hotspot.
- Video over H.264 in binary WebSocket frames, decoded in the browser with
  WebCodecs (Tesla browser is Chromium 140+ since 2026.14.6.10).
- Page learns the transport and touch capability from the phone and adapts.
- Repository restructured into `android/`, `ios/`, `web/`, `tools/`, `docs/`.
- Docs made platform-neutral; per-platform details split out.

## Non-goals

- Touch, Back/Home/Recents on iOS.
- Audio over the page (Bluetooth, as on Android).
- WebRTC on iOS in this version (it is the fallback plan, see Risks).
- App Store, TestFlight, paid developer account.
- Behavior changes on Android beyond the two new `state` fields and the move
  to `android/`.

## Target environment

- iPhone 15 Pro on iOS 26+; deployment target iOS 17 (ReplayKit broadcast,
  VideoToolbox, Network APIs are older than that).
- Tesla browser Chromium 140+ with WebCodecs; H.264 decode assumed (Theater
  uses it) and verified in the car on the first run.
- Build machine: macOS with Xcode 26+, XcodeGen, SideStore for install and
  weekly re-signing with a free Apple ID (limits: 3 apps, 10 app ids per
  7 days; this project uses 2 ids: app + extension; no App Groups needed).
- Linux (this machine) does everything else: web, docs, Android, and the
  platform-independent Swift package tests in a `swift:6.1` Docker container.

## Repository layout

```
android/     Gradle project (moved from the root): app/, gradle/, gradlew, settings.gradle.kts
ios/         project.yml (XcodeGen), TeslaMirror/ (app), TeslaMirrorBroadcast/ (extension), MirrorCore/ (SwiftPM)
web/         page served by both platforms (public/), tests
tools/       dev scripts
docs/        architecture.md (overview), android.md, ios.md, protocol.md, development.md, device-setup.md, car-checklist.md, decisions/
```

The Android `resources.srcDir` becomes `../../web`. The docs-check hook watches
`android/`, `ios/`, `web/`, `tools/`. Claude permissions use `android/gradlew`.

## Protocol changes (docs/protocol.md)

`state` gains two required fields:

```json
{"t":"state","capturing":true,"accessibility":false,"capture":{"w":588,"h":1278},
 "transport":"h264ws","touch":false}
```

- Android sends `"transport":"webrtc","touch":true`; iOS sends
  `"transport":"h264ws","touch":false`.
- With `touch:false` the page hides the side panel (keeps the debug toggle in
  the overlay corner), registers no touch listeners, and sends no `touch`/`key`
  messages.
- With `transport:"h264ws"` the page does not create a peer connection; the
  phone sends video as binary WebSocket messages:

```
byte 0      version = 1
byte 1      flags: bit0 = keyframe
bytes 2-3   reserved (0)
bytes 4-11  presentation time, microseconds, unsigned little-endian
bytes 12-15 reserved (0)
bytes 16..  H.264 Annex B access unit (start codes); SPS and PPS precede every keyframe
```

Nothing is sent from the page to an iOS phone besides opening the socket.
Optional `GET /health` returns `{"capturing":bool}`; the iOS app uses it to
show whether the extension's server is up.

## Page (web/public)

- `h264.js` (new): `WebSocket.binaryType = "arraybuffer"`, parses the header,
  feeds `VideoDecoder` configured as `{codec: "avc1.4D401F", optimizeForLatency: true}`
  in Annex B mode (no `description`); first chunk must be a keyframe; output
  frames are drawn on a `<canvas class="video">` sized to the frame, same
  fitting rules as the video element; `frame.close()` after draw. If
  `decoder.decodeQueueSize > 2`, chunks are dropped until the next keyframe.
  On `VideoDecoder.isConfigSupported` false or a decoder error, the overlay
  shows `decoder: unsupported` and the hint explains it.
- `app.js`: branches on `state.transport`; `state.touch` controls panel and
  touch capture; first-frame hint reused for both transports.
- Overlay adds `transport`, `decoder`, `dropped`.
- Types in `types.js` extended; tests for the header parser and the drop rule.

## iOS app (ios/TeslaMirror, SwiftUI)

Minimal: hotspot URL (address of `bridge100` if present, else the text
`http://172.20.10.1:8080`), a "Start broadcast" button hosting
`RPSystemBroadcastPickerView` with `preferredExtension` set to the extension
id and the microphone button hidden, a server indicator polled from
`http://127.0.0.1:8080/health` every 2 s, and the three setup reminders
(Personal Hotspot on, Auto-Lock Never, Bluetooth to the car). No App Group,
no background modes.

## Broadcast extension (ios/TeslaMirrorBroadcast)

`RPBroadcastSampleHandler` subclass wires five units:

| Unit | Responsibility |
|------|----------------|
| `WebServer` | Telegraph HTTP server on 0.0.0.0:8080 serving `public/` from the extension bundle (folder reference to `../web/public`), `GET /health`, WebSocket `/ws`; one client, newest wins; sends `state` on connect and on change. |
| `FrameSource` | Receives video `CMSampleBuffer`s, throttles to 30 fps, scales to half size (even dimensions) with `VTPixelTransferSession` into a pixel buffer pool. |
| `H264Encoder` | `VTCompressionSession`: realtime, profile Main auto-level, `AllowFrameReordering=false`, `MaxKeyFrameInterval=60`, `ExpectedFrameRate=30`, `AverageBitRate=4_000_000`, `DataRateLimits=[500_000 B, 1 s]`; emits `EncodedFrame(isKey, pts, nalUnits)`; honors a force-keyframe request. |
| `FramePump` | Uses `MirrorCore.DropPolicy`: tracks bytes queued on the socket; when the backlog exceeds 1 MB drops non-key frames and asks the encoder for a keyframe; packs frames with `MirrorCore.AnnexB` + `FrameHeader` and hands them to `WebServer`. |
| `SampleHandler` | Lifecycle: `broadcastStarted` → start server, source, encoder; `broadcastPaused/Resumed` → pause/resume encoding and publish `capturing`; `broadcastFinished` → stop all; memory warnings → log. |

Memory budget: stay under 50 MB (extension limit). Half-scale capture and a
pool of 3 pixel buffers fit with room; if the device log shows the limit being
hit, the scale constant drops to 1/3.

## MirrorCore (ios/MirrorCore, SwiftPM, no Apple frameworks)

- `FrameHeader`: encode/decode of the 16-byte header.
- `AnnexB`: converts length-prefixed NAL units (as VideoToolbox delivers them)
  to start-code form and prepends SPS/PPS to keyframes.
- `DropPolicy`: pure state machine `decide(frameIsKey, backlogBytes) -> .send | .drop | .dropAndRequestKey`,
  with the 1 MB threshold and "wait for key after a drop" rule.
- Tests for all three, run with `swift test` on macOS or in Docker on Linux.

## Android changes

- Move to `android/`; `state` sends `transport:"webrtc"`, `touch:true`.
- No behavior change otherwise; tests stay green.

## Startup and recovery (iOS)

- Broadcast must be started by the user once per drive (picker button or
  Control Center). It survives app switching and screen rotation; it stops
  when the phone locks, hence Auto-Lock Never while charging.
- Page reconnect logic is unchanged; on reconnect the phone sends `state` and
  the next keyframe starts the decoder.
- If the extension is killed (memory), iOS ends the broadcast; the page shows
  "Tap Start on phone".

## Risks and fallbacks

| Risk | Mitigation |
|------|------------|
| Tesla's Chromium has no H.264 in WebCodecs | Overlay shows it in the first minute. Fallback: WebRTC inside the extension with the existing `peer.js` path (separate spec; same page and protocol). |
| Extension exceeds 50 MB | Scale constant to 1/3; no WebRTC keeps the baseline low. |
| Telegraph unmaintained or too heavy | Replace with a small Network.framework server; the `WebServer` boundary isolates it. |
| Free-account signing expires weekly | SideStore re-signs on the phone; limits documented. |
| Portrait-only picture when the phone lies flat | Accepted; no software override exists on iOS. |

## Development loop

- Linux: web (`npm test`, `typecheck`, `format`), docs, Android (`android/gradlew`),
  MirrorCore (`docker run --rm -v $PWD/ios/MirrorCore:/src -w /src swift:6.1 swift test`).
- macOS: `brew install xcodegen`, `cd ios && xcodegen generate`, open the
  project, build, fix anything Linux could not compile, run on the iPhone;
  page in desktop Chrome at `http://<iphone-ip>:8080` while both are on the
  same Wi-Fi; export an `.ipa` for SideStore.
- Car: `docs/car-checklist.md` gets an iOS section (hotspot URL, decoder
  support, latency, memory, lock behavior).

## Docs

README and AGENTS.md describe both platforms; `docs/architecture.md` becomes
the shared overview with `docs/android.md` and `docs/ios.md` for details;
`development.md`, `device-setup.md`, `car-checklist.md` get per-platform
sections; `docs/decisions/2026-10-19-ios-h264-over-websocket.md` records why
iOS uses H.264 over WebSocket instead of WebRTC.
