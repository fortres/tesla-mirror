# iOS mirror (view-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror an iPhone screen into the Tesla browser (view-only) next to the existing Android app, in one repo with one page and one protocol.

**Architecture:** Android moves to `android/`; `state` gains `transport` and `touch`; the page gets an H.264-over-WebSocket path decoded with WebCodecs onto a canvas; iOS ships an app plus a ReplayKit Broadcast Upload Extension that serves the page and streams VideoToolbox H.264 in binary frames; pure Swift logic lives in a SwiftPM package tested on Linux in Docker.

**Tech Stack:** Kotlin/Gradle (existing), plain JS ES modules + JSDoc/tsc + Prettier (existing), Node 22 with `ws` (dev tool only), Swift 6.1 / SwiftPM, XcodeGen 2.46.0, Telegraph 0.40.0 (SPM), ReplayKit, VideoToolbox, SwiftUI.

**Spec:** `docs/superpowers/specs/2026-10-19-ios-mirror-design.md`

## Global Constraints

- Everything in English; comments only where non-obvious; docs change with code (AGENTS.md golden rule); one commit per task, 1–2 line message, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Web: plain JS ES modules, no build step, JSDoc types checked by `cd web && npm run typecheck` (0 errors, no pragmas, no ts-ignore), Prettier via `npm run format`; CSS: kebab-case classes, ids only as JS hooks, no tag selectors, no BEM.
- Android behavior unchanged except the two new `state` fields; Android tests and `assembleDebug` stay green after the move.
- `state` adds `"transport": "webrtc" | "h264ws"` and `"touch": boolean`; Android sends `webrtc`/`true`, iOS sends `h264ws`/`false`.
- Binary frame: 16-byte header — byte0 version=1, byte1 flags bit0=keyframe, bytes2–3 zero, bytes4–11 pts µs unsigned little-endian, bytes12–15 zero — then one H.264 Annex B access unit; SPS+PPS before every keyframe.
- Golden header vector (both languages test it): keyframe, pts 1_000_000 µs → `01 01 00 00 40 42 0f 00 00 00 00 00 00 00 00 00`.
- Encoder: 30 fps, half-scale even dimensions, Main profile auto level, no frame reordering, keyframe every 60 frames, average 4_000_000 bps, data-rate limit 500_000 bytes per 1 s.
- Drop rule: backlog > 1_048_576 bytes → drop non-key frames and request a keyframe; after any drop, send nothing until the next keyframe.
- Page decoder: codec `avc1.4D401F`, `optimizeForLatency: true`, Annex B (no `description`), first chunk must be key, drop to next key when `decodeQueueSize > 2`.
- iOS: deployment target 17.0; bundle ids `app.teslamirror.ios` and `app.teslamirror.ios.broadcast`; port 8080; `GET /health` → `{"capturing":bool}`; hotspot URL fallback `http://172.20.10.1:8080`; no App Groups, no background modes.
- Swift on Linux: `docker run --rm -v "$PWD":/src -w /src/ios/MirrorCore swift:6.1 swift test`. Apple-framework Swift files cannot compile here; check them with `docker run --rm -v "$PWD":/src -w /src swift:6.1 swiftc -parse <files>` (syntax only).

## Review Focus

1. A page that connects mid-stream receives P-frames first: it must ignore everything until a keyframe, never feed the decoder a non-key first chunk → test in Task 3 (`createKeyGate`).
2. Truncated or wrong-version binary messages must be ignored, not crash the decoder → test in Task 3 (`parseFrame` returns null for < 16 bytes and version ≠ 1).
3. A page talking to an Android phone must behave exactly as before (WebRTC, touch, panel) when `transport` is `webrtc` — and also when an older phone omits the new fields → test in Task 4 (`transportOf(state)` defaults to `webrtc`/`true`).
4. A slow socket must not grow the phone's memory without bound: backlog over the limit drops frames and recovers on the next keyframe → test in Task 6 (`DropPolicy` sequence).
5. Length-prefixed NAL units with a 4-byte length that overruns the buffer must not crash Annex B conversion → test in Task 6 (`AnnexB.fromLengthPrefixed` returns nil).

---

### Task 1: Move the Android project into `android/`

**Files:**
- Move (git mv): `app/` → `android/app/`, `gradle/` → `android/gradle/`, `gradlew`, `gradlew.bat`, `settings.gradle.kts`, `build.gradle.kts`, `gradle.properties` → `android/`
- Modify: `android/app/build.gradle.kts` (srcDir), `.claude/hooks/check-docs.sh`, `.claude/settings.json`, `.gitignore`, `.prettierignore`, `web/package.json` (format globs if they reference `app/`), `AGENTS.md`, `README.md`, `docs/*.md` (paths and commands only)

- [ ] **Step 1:** `git mv` the listed paths; `resources.srcDir("../../web")` in `android/app/build.gradle.kts`.
- [ ] **Step 2:** Hook regex `^(android|ios|web|tools)/`; message text lists those folders. Settings permissions become `Bash(cd android && ./gradlew test*)`, `assembleDebug*`, `installDebug*`. `.gitignore`: keep root patterns (they match nested `build/`, `.gradle/`); add `ios/*.xcodeproj/` and `ios/build/`. `.prettierignore`: `android/`, keep the rest.
- [ ] **Step 3:** Replace every `./gradlew` command in docs with `cd android && ./gradlew …`, every `app/src/...` path with `android/app/src/...`, the APK path with `android/app/build/outputs/apk/debug/app-debug.apk`; AGENTS.md Layout block shows the new tree from the spec.
- [ ] **Step 4: Verify:** `cd android && ./gradlew clean test assembleDebug --console=plain` → `BUILD SUCCESSFUL`; `unzip -l app/build/outputs/apk/debug/app-debug.apk | grep -c 'public/index.html'` → `1`; `cd ../web && npm test && npm run typecheck && npm run format:check` green; `git grep -nE '(^|[^/])\./gradlew' -- docs README.md AGENTS.md | grep -v 'cd android'` → empty.
- [ ] **Step 5: Commit** `Move the Android project into android/`.

---

### Task 2: Protocol fields and wire format

**Files:**
- Modify: `android/app/src/main/java/app/teslamirror/net/Protocol.kt`, `android/app/src/test/java/app/teslamirror/net/ProtocolTest.kt`, `docs/protocol.md`

**Interfaces:**
- Produces: `Protocol.state(...)` output contains `"transport":"webrtc","touch":true` (signature unchanged).

- [ ] **Step 1: Failing test** in `buildsState`: `assertEquals("webrtc", j["transport"]!!.jsonPrimitive.content)` and `assertEquals(true, j["touch"]!!.jsonPrimitive.boolean)`.
- [ ] **Step 2:** `cd android && ./gradlew :app:testDebugUnitTest --tests '*ProtocolTest*'` → FAIL.
- [ ] **Step 3:** Add the two fields after `capture` in `Protocol.state`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** `docs/protocol.md`: `state` row lists `transport` and `touch` with meanings; new section "Binary video frames (`transport: h264ws`)" with the header table, the golden vector line, the keyframe/SPS-PPS rule, "page sends nothing to an h264ws phone besides opening the socket"; `GET /health` (iOS only).
- [ ] **Step 6: Commit** `Add transport and touch to state; document binary video frames`.

---

### Task 3: Page frame parsing and gates (pure)

**Files:**
- Create: `web/public/frame.js`, `web/test/frame.test.mjs`
- Modify: `web/public/types.js`

**Interfaces:**
- Produces:
```js
/** @typedef {{ key: boolean, ptsUs: number, data: Uint8Array }} VideoFrame */
export function parseFrame(buf)            // ArrayBuffer -> VideoFrame | null (null if < 16 bytes or version !== 1)
export function createKeyGate()            // { accept(key: boolean, queueSize: number): boolean }
export const MAX_DECODE_QUEUE = 2
```
`accept`: returns false until the first key; after that, if `queueSize > MAX_DECODE_QUEUE` it returns false and re-arms (waits for the next key); a key always passes and disarms. `ptsUs` read as `Number(view.getBigUint64(4, true))`.
Also add to `types.js`: `@typedef {'webrtc'|'h264ws'} Transport` and `StateMsg` gains `transport?: Transport`, `touch?: boolean` (optional: older phones omit them).

- [ ] **Step 1: Failing tests** in `frame.test.mjs`:
  - `parseFrame reads the golden header`: bytes `01 01 00 00 40 42 0f 00 00 00 00 00 00 00 00 00` + `[0,0,0,1,0x65]` → `{key: true, ptsUs: 1000000}`, `data` equals the 5 payload bytes.
  - `parseFrame rejects short and wrong-version buffers`: 15 bytes → null; version 2 → null.
  - `key gate waits for the first keyframe`: `accept(false,0)` false, `accept(true,0)` true, `accept(false,0)` true.
  - `key gate drops to the next keyframe on backlog`: after a key, `accept(false,3)` false, `accept(false,0)` false, `accept(true,0)` true.
- [ ] **Step 2:** `cd web && npm test` → FAIL (module missing).
- [ ] **Step 3:** Implement `frame.js` (no imports, no browser globals).
- [ ] **Step 4:** `npm test` (12 pass), `npm run typecheck`, `npm run format:check`.
- [ ] **Step 5: Commit** `Add binary frame parser and key gate for the page`.

---

### Task 4: H.264 path on the page

**Files:**
- Create: `web/public/h264.js`, `web/public/caps.js`, `web/test/caps.test.mjs`
- Modify: `web/public/app.js`, `web/public/ws.js`, `web/public/index.html`, `web/public/style.css`, `web/public/debug.js` (only if a new key needs formatting), `docs/architecture.md` (browser section)

**Interfaces:**
- Consumes: `parseFrame`, `createKeyGate` (Task 3).
- Produces:
```js
// caps.js (pure)
export function transportOf(state)  // StateMsg -> { transport: Transport, touch: boolean }; missing fields -> 'webrtc' / true
// h264.js (browser)
export function startH264({ canvas, onFirstFrame, onStat })  // -> { push(buf: ArrayBuffer): void, close(): void }
export async function h264Supported()                         // -> boolean via VideoDecoder.isConfigSupported
// ws.js
connect({ ..., onBinary })   // binaryType 'arraybuffer'; ArrayBuffer messages go to onBinary, text as before
```
`startH264`: `VideoDecoder` with the Global Constraints config; each pushed buffer → `parseFrame` → gate → `new EncodedVideoChunk({type, timestamp: ptsUs, data})`; output: size canvas to the frame's `displayWidth/Height` once, `drawImage`, `frame.close()`, first output → `onFirstFrame()`; `onStat({dropped, decoded})` at most once per second; decoder `error` → `onStat({error})` and the gate re-arms after `decoder.reset()` + reconfigure.
`app.js`: on `state`, `transportOf` decides: `webrtc` → existing peer path untouched; `h264ws` → no peer, `startH264` once, `#canvas` shown and `#video` hidden; on WS close tear the H.264 session down. `touch === false` → no touch listeners act (early return in the touch handler), `[data-key]` buttons and `#a11y` hidden, `#debugToggle` stays. Overlay keys: `transport`, `decoder` (`yes|no` from `h264Supported` at first h264ws state; `no` → hint title "Browser cannot decode H.264", text "Use the Android phone or update the car"), `dropped`. Box fitting for touch is irrelevant on iOS; canvas uses the same `.video` class (object-fit contain).
`index.html`: `<canvas id="canvas" class="video" hidden></canvas>` after the video.

- [ ] **Step 1: Failing tests** `caps.test.mjs`: `transportOf({t:'state',capturing:true,accessibility:true,capture:{w:1,h:1}})` → `{transport:'webrtc',touch:true}`; with `transport:'h264ws', touch:false` → same values back.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement `caps.js`, `h264.js`, `ws.js` `onBinary`, markup, CSS (only class rules), `app.js` wiring as above.
- [ ] **Step 4:** `npm test` (14 pass), `npm run typecheck` 0, `npm run format:check`, `node --check` on each module, `cd ../android && ./gradlew assembleDebug` green.
- [ ] **Step 5: Docs:** architecture.md browser section: one paragraph on the two transports and `touch:false`; file table rows for `frame.js`, `h264.js`, `caps.js`.
- [ ] **Step 6: Commit** `Add H.264 over WebSocket playback to the page`.

---

### Task 5: `tools/fake-ios.mjs` and a Linux end-to-end check

**Files:**
- Create: `tools/fake-ios.mjs`
- Modify: `web/package.json` (devDependency `ws` pinned to the exact latest 8.x, currently 8.22.0), `docs/development.md`

**Interfaces:**
- Produces: `node tools/fake-ios.mjs <annexb.h264> [port=8080]` — HTTP server for `web/public/` and `GET /health`, WebSocket `/ws` (newest client wins) that sends `state` `{capturing:true, accessibility:false, capture:{w,h}, transport:'h264ws', touch:false}` and then the file's access units at 30 fps in binary frames, looping; first unit sent to a new client is the next keyframe. Splits the file into access units at AUD NAL units (type 9); a unit is key if it contains NAL type 5; pts from a 33_333 µs counter. `w,h` come from the CLI (`--size 640x1280`, default 640x1280).

- [ ] **Step 1:** Write the tool (Node 22, `ws` import, no other dependencies); `node --check`; typed via JSDoc (`tools/` is in tsconfig).
- [ ] **Step 2:** Make a fixture in the scratchpad (not the repo):
```
docker run --rm -v /tmp/claude-1000/-home-romas/4bd7384c-789a-4c1c-989b-44f047040536/scratchpad:/out jrottenberg/ffmpeg:7.1-ubuntu \
  -f lavfi -i testsrc2=size=640x1280:rate=30 -t 10 -c:v libx264 -profile:v main -bf 0 -g 60 \
  -x264-params aud=1:repeat-headers=1 -bsf:v h264_mp4toannexb -f h264 /out/fixture.h264
```
- [ ] **Step 3: End-to-end:** run the tool; headless `/usr/bin/google-chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<scratch>/chrome-e2e http://localhost:8080`; via CDP read the overlay text (expect `transport: h264ws`, `decoder: yes`) and sample `document.querySelector('#canvas').width` (640) and the overlay decoded count twice 2 s apart (increasing); screenshot to the scratchpad and look at it; confirm the side panel shows only the debug button. Reconnect: reload the page; frames resume. Kill Chrome and the tool; confirm with `pgrep`.
- [ ] **Step 4: Docs:** development.md "Page without a phone (iOS path)": fixture command, tool usage, what to expect.
- [ ] **Step 5: Commit** `Add fake iOS stream tool for testing the H.264 page path`.

---

### Task 6: MirrorCore (SwiftPM)

**Files:**
- Create: `ios/MirrorCore/Package.swift`, `ios/MirrorCore/Sources/MirrorCore/{FrameHeader,AnnexB,DropPolicy}.swift`, `ios/MirrorCore/Tests/MirrorCoreTests/{FrameHeaderTests,AnnexBTests,DropPolicyTests}.swift`

**Interfaces:**
- Produces (Foundation only, no Apple-only frameworks):
```swift
public enum FrameHeader {
    public static let size = 16
    public static func encode(isKey: Bool, ptsUs: UInt64) -> [UInt8]
    public static func decode(_ bytes: [UInt8]) -> (isKey: Bool, ptsUs: UInt64)?   // nil if < 16 or version != 1
}
public enum AnnexB {
    public static let startCode: [UInt8] = [0, 0, 0, 1]
    public static func fromLengthPrefixed(_ data: [UInt8], lengthSize: Int = 4) -> [UInt8]?   // nil on overrun or zero-size NAL
    public static func keyframe(sps: [UInt8], pps: [UInt8], body: [UInt8]) -> [UInt8]          // start+sps, start+pps, body
}
public struct DropPolicy {
    public enum Decision: Equatable { case send, drop, dropAndRequestKey }
    public init(limitBytes: Int = 1_048_576)
    public mutating func decide(isKey: Bool, backlogBytes: Int) -> Decision
}
```
`decide`: key → `.send` and clears the waiting flag; non-key while waiting → `.drop`; non-key with backlog > limit → `.dropAndRequestKey` and sets waiting; else `.send`.
`Package.swift`: swift-tools-version 5.9, platforms `.iOS(.v17), .macOS(.v13)`, library `MirrorCore`, XCTest test target.

- [ ] **Step 1: Failing tests:**
  - `testGoldenHeader`: `encode(isKey: true, ptsUs: 1_000_000)` == the golden bytes; `decode` round-trips; `decode` of 15 bytes and of version 2 → nil.
  - `testLengthPrefixedToAnnexB`: `[0,0,0,2, 0x65,0x88, 0,0,0,1, 0x41]` → `[0,0,0,1,0x65,0x88, 0,0,0,1,0x41]`; `[0,0,0,9, 0x65]` → nil; `[0,0,0,0]` → nil.
  - `testKeyframePrependsParameterSets`: `keyframe(sps:[0x67,1], pps:[0x68,2], body:[0,0,0,1,0x65])` == `[0,0,0,1,0x67,1, 0,0,0,1,0x68,2, 0,0,0,1,0x65]`.
  - `testDropPolicySequence`: limit 100: `(false,10)`→send, `(false,200)`→dropAndRequestKey, `(false,0)`→drop, `(true,500)`→send, `(false,0)`→send.
- [ ] **Step 2:** Docker `swift test` (Global Constraints) → FAIL (missing symbols).
- [ ] **Step 3:** Implement the three files.
- [ ] **Step 4:** Docker `swift test` → all pass.
- [ ] **Step 5: Commit** `Add MirrorCore Swift package with frame header, Annex B and drop policy`.

---

### Task 7: iOS project definition and host app

**Files:**
- Create: `ios/project.yml`, `ios/TeslaMirror/{TeslaMirrorApp.swift, ContentView.swift, HotspotAddress.swift, Info.plist}`, `ios/README.md` (5 lines: what is here, `xcodegen generate`, link to docs/ios.md)

**Interfaces:**
- Produces: XcodeGen project `TeslaMirror` with targets `TeslaMirror` (application, `app.teslamirror.ios`) and `TeslaMirrorBroadcast` (app-extension, `app.teslamirror.ios.broadcast`, embedded in the app; sources created in Task 8); package dependencies `Telegraph` (`https://github.com/Building42/Telegraph`, exact `0.40.0`) for the extension and local `MirrorCore` (`path: MirrorCore`) for both; extension resources: folder reference `../web/public` copied as `public`; `deploymentTarget: iOS: "17.0"`; `CODE_SIGN_STYLE: Automatic`, `DEVELOPMENT_TEAM` left empty (set in Xcode); Swift 5 language mode; extension Info.plist `NSExtension` with `NSExtensionPointIdentifier = com.apple.broadcast-services-upload`, `NSExtensionPrincipalClass = $(PRODUCT_MODULE_NAME).SampleHandler`, `RPBroadcastProcessMode = RPBroadcastProcessModeSampleBuffer`.
- `HotspotAddress.current() -> String?`: `getifaddrs`, IPv4 of an interface whose name starts with `bridge` (`bridge100` when Personal Hotspot is on); `ContentView` shows `http://<addr>:8080` or `http://172.20.10.1:8080`.
- `ContentView`: the URL (large, monospaced), a `BroadcastPicker` (`UIViewRepresentable` wrapping `RPSystemBroadcastPickerView`, `preferredExtension = "app.teslamirror.ios.broadcast"`, `showsMicrophoneButton = false`, 60 pt) with the label "Start broadcast", a status line from polling `http://127.0.0.1:8080/health` every 2 s ("Streaming" / "Not streaming"), and three reminders: Personal Hotspot on; Auto-Lock → Never; Bluetooth to the car.

- [ ] **Step 1:** Write `project.yml` and the app files.
- [ ] **Step 2: Verify (Linux):** `docker run --rm -v "$PWD":/src -w /src swift:6.1 swiftc -parse ios/TeslaMirror/*.swift` → no output; `python3 -c "import yaml,sys;yaml.safe_load(open('ios/project.yml'))"` (install `python3-yaml` in a throwaway container if missing) → no error; `plutil` is not available — check the Info.plist with `python3 -c "import plistlib;plistlib.load(open('ios/TeslaMirror/Info.plist','rb'))"`.
- [ ] **Step 3: Commit** `Add iOS project definition and host app`.

---

### Task 8: Broadcast Upload Extension

**Files:**
- Create: `ios/TeslaMirrorBroadcast/{SampleHandler.swift, WebServer.swift, FrameSource.swift, H264Encoder.swift, FramePump.swift, Info.plist}`

**Interfaces:**
- Consumes: `FrameHeader`, `AnnexB`, `DropPolicy` (Task 6); Telegraph `Server`, `HTTPResponse`, `WebSocket`; project wiring (Task 7).
- Produces:
```swift
final class WebServer {                 // Telegraph; one client, newest wins
    init(port: Int = 8080, publicDir: URL)
    func start() throws; func stop()
    var capturing: Bool                 // feeds /health and state
    var captureSize: (w: Int, h: Int)
    func sendState()                    // {"t":"state","capturing","accessibility":false,"capture":{w,h},"transport":"h264ws","touch":false}
    func sendBinary(_ bytes: [UInt8])
    var backlogBytes: Int { get }       // bytes handed to the socket not yet confirmed written
    var onClientConnected: (() -> Void)?
}
final class FrameSource {               // 30 fps throttle, half scale via VTPixelTransferSession, 3-buffer pool
    init(onFrame: @escaping (CVPixelBuffer, CMTime) -> Void)
    func handle(_ sample: CMSampleBuffer)
    private(set) var outputSize: (w: Int, h: Int)
}
final class H264Encoder {               // VTCompressionSession with the Global Constraints settings
    init(width: Int, height: Int, onFrame: @escaping (_ isKey: Bool, _ ptsUs: UInt64, _ annexB: [UInt8]) -> Void)
    func encode(_ buffer: CVPixelBuffer, pts: CMTime)
    func requestKeyframe()
    func invalidate()
}
final class FramePump {                 // DropPolicy + FrameHeader, then WebServer.sendBinary
    init(server: WebServer, encoder: H264Encoder)
    func push(isKey: Bool, ptsUs: UInt64, annexB: [UInt8])
}
class SampleHandler: RPBroadcastSampleHandler  // wires the above; paused/resumed/finished; logs memory warnings via os.Logger(subsystem: "app.teslamirror.ios", category: "broadcast")
```
Notes the implementer cannot infer: the encoder is (re)created when `FrameSource.outputSize` changes (rotation); a new WebSocket client triggers `requestKeyframe()` and `sendState()`; `backlogBytes` is maintained by counting bytes on send and subtracting in Telegraph's write completion — if Telegraph exposes no completion, approximate with a per-client serial queue counting pending sends and document the approximation in docs/ios.md; `publicDir` = `Bundle.main.url(forResource: "public", withExtension: nil)`; SPS/PPS from `CMVideoFormatDescriptionGetH264ParameterSetAtIndex` on keyframes, body from `CMBlockBuffer` via `AnnexB.fromLengthPrefixed`; video samples only (ignore audio types).

- [ ] **Step 1:** Write the six files.
- [ ] **Step 2: Verify (Linux):** `swiftc -parse` on `ios/TeslaMirrorBroadcast/*.swift` in Docker → no output; Info.plist loads with `plistlib`; `grep -c 'requestKeyframe' ios/TeslaMirrorBroadcast/*.swift` shows it is called from both `FramePump` and `SampleHandler`.
- [ ] **Step 3: Commit** `Add broadcast extension that streams H.264 over WebSocket`.

---

### Task 9: Platform-neutral docs

**Files:**
- Create: `docs/android.md`, `docs/ios.md`, `docs/decisions/2026-10-19-ios-h264-over-websocket.md`
- Modify: `README.md`, `AGENTS.md`, `docs/architecture.md`, `docs/development.md`, `docs/device-setup.md`, `docs/car-checklist.md`

- [ ] **Step 1:** `architecture.md` becomes the shared overview (both platforms, the page, the protocol, transports); Android component table, gesture model, orientation and Android startup move to `android.md`; `ios.md` covers the app, the extension units (table from the spec), memory budget, broadcast lifecycle, signing with SideStore (free Apple ID: 3 apps, 10 app ids per 7 days, this project uses 2), and the Mac build steps (`brew install xcodegen`, `cd ios && xcodegen generate`, set the team in Xcode, build to device, Product → Archive → export for SideStore).
- [ ] **Step 2:** README: pitch "Mirror an Android phone or an iPhone into the Tesla browser"; feature list per platform (Android: control from the Tesla; iPhone: view-only); requirements per platform; limitations per platform. AGENTS.md: intro and Status for both platforms, rules line "iOS: Swift, XcodeGen `project.yml` is the source of truth, never commit `.xcodeproj`; pure logic in `ios/MirrorCore`", Docs list includes `android.md`, `ios.md`.
- [ ] **Step 3:** device-setup.md and car-checklist.md: "Android" and "iPhone" sections; iPhone checklist: hotspot URL `172.20.10.1`, overlay `decoder: yes`, latency, picture survives app switching, broadcast stops on lock (Auto-Lock Never), extension memory (device log `broadcast` category), Bluetooth audio.
- [ ] **Step 4:** Decision record: Context (no touch API on iOS; WebRTC in a 50 MB extension is risky; Tesla Chromium 140+ has WebCodecs), Decision (H.264 Annex B over WebSocket, WebCodecs on canvas), Consequences (TCP latency managed by the drop policy; fallback WebRTC in the extension if WebCodecs lacks H.264).
- [ ] **Step 5: Verify:** `git grep -n 'Model 3 2021+\|in-car phone' -- README.md AGENTS.md docs/*.md` shows no Android-only claims left in shared docs; every doc link resolves (`grep -o '](docs/[^)]*)'` + `test -f`).
- [ ] **Step 6: Commit** `Make docs platform-neutral and add Android and iOS guides`.
