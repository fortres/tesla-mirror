# iPhone

View-only mirror: a SwiftUI app and a ReplayKit Broadcast Upload Extension that
serves the page and streams H.264 over WebSocket. Shared overview:
[architecture.md](architecture.md); why this transport:
[decision](decisions/2026-10-19-ios-h264-over-websocket.md). Setup:
[device-setup.md](device-setup.md#iphone).

Transport `h264ws`, `touch: false`. Targets iOS 17+ (target device: iPhone 15 Pro,
iOS 26). Sources in `ios/`; `ios/project.yml` (XcodeGen) is the source of
truth, the `.xcodeproj` is generated and never committed.

## Host app (`ios/TeslaMirror/`)

Shows the hotspot URL (`bridge*` interface address, else
`http://172.20.10.1:8080`), a "Start broadcast" button (`RPSystemBroadcastPickerView`,
microphone hidden), a streaming indicator polled from `http://127.0.0.1:8080/health`
every 2 s, and setup reminders. The extension id is derived from the app's own
bundle id, because SideStore rewrites bundle ids.

## Extension (`ios/TeslaMirrorBroadcast/`)

| Unit | Responsibility |
|------|----------------|
| `WebServer` | Telegraph HTTP server on :8080: `public/` from the bundle, `GET /health`, WebSocket `/ws`; one client, newest wins; sends `state` on connect and change. Measures backlog with WebSocket ping/pong (each ping carries the bytes sent so far); Telegraph's own pings are off; a 30 s keep-alive ping runs. |
| `FrameSource` | Receives `CMSampleBuffer`s, throttles to 30 fps, scales to half size into a pixel pool. ReplayKit delivers portrait buffers plus an orientation attachment; `FrameRotator` (`VTPixelRotationSession`) rotates landscape frames upright, and the encoder is rebuilt on a size change. Re-encodes the last frame on demand. |
| `H264Encoder` | `VTCompressionSession`: realtime, Main profile, no reordering, keyframe every 60 frames, 4 Mbit/s. Force-keyframe on request. |
| `FramePump` | `MirrorCore.DropPolicy` on the ping/pong backlog: over 1 MB it drops frames (keyframes too) until the backlog drains, then waits for a keyframe. Packs frames with `FrameHeader` + `AnnexB`. |
| `SampleHandler` | Broadcast lifecycle (below). |

`ios/MirrorCore` (SwiftPM, no Apple frameworks): `FrameHeader`, `AnnexB`,
`DropPolicy`, tested on Linux.

On connect, resume, and after a drop the extension re-encodes the last frame so
a static screen still shows a picture.

## Memory budget

The extension must stay under about 50 MB. Half-scale frames and a pixel pool
capped at 3 buffers fit; no WebRTC keeps the baseline low. If the device log
(`broadcast` category) shows memory warnings, lower the scale constant to 1/3.

## Broadcast lifecycle

- The user starts the broadcast once per drive (picker button or Control Center).
- `broadcastStarted` starts server, source and encoder; pause/resume toggle
  `capturing` in `state`; `broadcastFinished` stops everything.
- It survives app switching and rotation, and stops when the phone locks:
  set Auto-Lock to Never while charging.
- If iOS kills the extension (memory), the broadcast ends and the page shows
  "Tap Start on phone".

## Signing and install (SideStore)

Free Apple ID limits: 3 apps, 10 app ids per 7 days; this project uses 2 ids
(app + extension), no App Groups. SideStore re-signs weekly on the phone and
rewrites bundle ids.

## Build on a Mac

1. `brew install xcodegen`
2. `cd ios && xcodegen generate`
3. Open `TeslaMirror.xcodeproj`, set your team on both targets (Signing).
4. Build and run on the iPhone.
5. Product -> Archive -> export the `.ipa`, install with SideStore.

### First build on a Mac

Written on Linux without Xcode; the extension was only syntax-checked. Expect
to fix compile errors in these calls:

- [ ] Telegraph: `server.route(.GET, "/health") { _ in … }` overload, `HTTPResponse(.ok, headers:, content:)`, `WebSocketMessage(opcode: .ping, payload: .binary(…))`, `server.webSocketConfig.pingInterval`, `ServerWebSocketDelegate` conformance.
- [ ] VideoToolbox encode: `VTCompressionSessionCreate` and `VTCompressionSessionEncodeFrame` labels, `VTSessionSetProperty` with CF constants, `CMBlockBufferCopyDataBytes`, `CMVideoFormatDescriptionGetH264ParameterSetAtIndex`, `nalUnitHeaderLengthOut`.
- [ ] Sample attachments: `CMSampleBufferGetSampleAttachmentsArray` cast to `[[CFString: Any]]`, `kCMSampleAttachmentKey_NotSync`.
- [ ] Scaling and rotation: `VTPixelTransferSession*`, `VTPixelRotationSessionCreate(nil, &session)` and `VTPixelRotationSessionRotateImage` unlabeled forms, `kVTRotation_CW90/CCW90`.
- [ ] Orientation: `CMGetAttachment(… RPVideoSampleOrientationKey …) as? NSNumber`, `CGImagePropertyOrientation(rawValue:)`.
- [ ] Pools and time: `CVPixelBufferPoolCreatePixelBufferWithAuxAttributes` with the allocation-threshold key, `CMTimeMaximum`, `CMClockGetTime(CMClockGetHostTimeClock())`.
- [ ] `H264Encoder` calling a non-escaping `onFailure` from `init` (mark `@escaping` if Swift complains).
- [ ] On the device: rotation direction (`.left` = CW90, `.right` = CCW90) is a guess; confirm landscape apps are upright. ReplayKit sample PTS is assumed to share the host time clock.
