# Development

Everything except Tesla-browser quirks can be developed and tested on a laptop.
Linux does web, Android, docs and the iOS `MirrorCore` tests; the iOS app and
extension need a Mac (see [ios.md](ios.md)).

## Requirements (Android)

- Android Studio with an API 30 (Android 11) emulator image.
- JDK 17 on the machine: the build pins `jvmToolchain(17)` and does not download a toolchain.
- Node 22+ for web tests and dev scripts (built-in WebSocket).

The build itself is host-independent (libwebrtc ships prebuilt for every
phone ABI); it works on Linux, macOS (Intel or Apple silicon) and Windows.
On Apple silicon use the `arm64-v8a` emulator image instead of `x86_64`.

```
sdkmanager "system-images;android-30;google_apis;x86_64"
avdmanager create avd -n tesla-mirror -k "system-images;android-30;google_apis;x86_64" -d pixel_2_xl
```

## Run on the emulator

1. Start the API 30 emulator.
2. Build and install `android/app` from Android Studio (or `cd android && ./gradlew installDebug`).
3. In the emulator: enable the app's accessibility service
   (Settings → Accessibility → tesla-mirror), open the app, tap Start, accept
   the screen capture dialog. (Headless: find the buttons with
   `adb shell uiautomator dump` and use `adb shell input tap`.)
4. The emulator has no hotspot, so the app shows "hotspot off" instead of a URL;
   reach the page with `adb forward tcp:8080 tcp:8080`.
5. Open `http://localhost:8080` in desktop Chrome. DevTools device mode gives
   touch events; pinch is Shift + drag.

The emulator image has no H.264 encoder and negotiates VP8 (H.264 is verified
on the phone, see [car-checklist.md](car-checklist.md)), so quality and latency are worse
than on a real phone. That is fine for development.

## Dev mode for the web page

The server serves the page from a folder on the device instead of classpath resources
when that folder exists, so the page can be iterated without rebuilding:

```
adb push web/public/. /sdcard/Android/data/app.teslamirror/files/web/
```

The folder is checked once at server start, so restart the app process after
pushing it (not by force-stop, which also disables the accessibility service;
if you force-stop, re-enable it, see the checklist below).
Delete that folder to go back to the bundled page. There is no in-app toggle.
Not for the car phone.

## Formatting and types

Web and tools code is formatted with Prettier (config in `.prettierrc`):
`cd web && npm install && npm run format`. Run `npm run format:check` and
`npm run typecheck` (`tsc`, strict `checkJs`) before committing. The page has
no build step; types live in JSDoc (shared typedefs in `web/public/types.js`).
Kotlin follows the Android Studio default formatter and `.editorconfig`.

## Tests

- Swift (`MirrorCore`, Linux or Mac): `docker run --rm -v "$PWD":/src -w /src/ios/MirrorCore swift:6.1 swift test`.
- Kotlin: `cd android && ./gradlew test`. Covers coordinate mapping and clamping,
  `GestureStreamer` snapshot → segments, message parsing.
- Web: `cd web && npm test`. Covers normalization with letterbox and touch
  coalescing. The same ES modules run in the browser and in node.
- Synthetic touch: `node tools/tap.mjs <x> <y> [host:port]` (x, y in 0..1,
  default `localhost:8080`) connects to `/ws` and sends a tap to confirm
  injection reaches the emulator. Exit codes: 0 sent, 1 cannot connect (5 s) or closed before the release, 2 bad arguments.

## iOS project on Linux

XcodeGen builds and runs on Linux in the `swift:6.1` image, which checks
`ios/project.yml` without a Mac. Build it once from a clone of XcodeGen 2.46.0,
then generate against a copy of `ios` and `web` (the project references
`../web/public`):

```
git clone --depth 1 --branch 2.46.0 https://github.com/yonaskolb/XcodeGen /tmp/xcodegen
docker run --rm -v /tmp/xcodegen:/xg -w /xg swift:6.1 swift build -c release
mkdir /tmp/gen && cp -r ios web /tmp/gen/
docker run --rm -e USER=root -v /tmp/xcodegen:/xg -v /tmp/gen:/gen -w /gen/ios swift:6.1 /xg/.build/release/xcodegen generate
```

`swiftc -parse` over the Swift files catches syntax errors only; compiling
needs Xcode.

## Page without a phone (iOS path)

`tools/fake-ios.mjs` plays the iPhone: it serves `web/public/` and `/health` and
streams an Annex B H.264 file as `h264ws` binary frames at 30 fps, looping. A new
client gets `state`, then frames starting at the next keyframe; the newest client
wins. No ffmpeg needed on the host (the fixture is made in Docker and kept in the
ignored `web/.cache/`):

```
cd web && npm install
npm run fake-ios:fixture        # once: 10 s test pattern, 640x1280
npm run fake-ios                # or fake-ios:sparse (one frame every 2 s after 3 s)
# open http://localhost:8080
node ../tools/fake-ios.mjs <file.h264> [port=8080] [--size 640x1280] [--sparse]
```

The stream must carry AUD NAL units (`aud=1` above); the tool splits access units at them.

`--sparse` sends one frame every 2 s after the first 3 s, like a static iPhone
screen. Open `http://localhost:8080` in Chrome: the overlay (debug button) shows
`transport: h264ws`, `decoder: yes`, growing `appended`, `latency` under 0.5 s;
only the debug button is in the panel. Reloading or reconnecting resumes within 2 s.

## Headless end-to-end

Headless Chrome (`google-chrome --headless=new --remote-debugging-port=9222
--autoplay-policy=no-user-gesture-required
--disable-features=WebRtcHideLocalIpsWithMdns http://localhost:8080`) stands in
for the Tesla browser, driven by a throwaway Node script over the DevTools
protocol: `Runtime.evaluate` reads `#debug` and `getVideoPlaybackQuality()`,
`Input.dispatchTouchEvent` sends tap, drag and pinch. The emulator NAT hides
the phone's UDP, so rewrite its `10.0.2.x` ICE candidates to `127.0.0.1` and run
`adb emu redir add udp:<port>:<port>` per port. Check effects with
`adb exec-out screencap -p`. A static screen emits no frames (fps 0).

## Manual checklist (laptop)

- Page shows "Tap Start on phone" before capture, video after Start.
- Tap, swipe, long press, pinch in DevTools device mode act on the emulator.
- Back/Home/Recents buttons work.
- Kill the app: page shows reconnecting, recovers after restart without reload.
  Force-stop disables the accessibility service; re-enable it with
  `adb shell settings put secure enabled_accessibility_services app.teslamirror/app.teslamirror.input.InputService; adb shell settings put secure accessibility_enabled 1`.
- Debug overlay shows fps, bitrate, ICE state, last touches.
- iPhone path: see "Page without a phone" above; with a Mac, open
  `http://<iphone-ip>:8080` in desktop Chrome on the same Wi-Fi.

Real-car verification is a separate trip: [car-checklist.md](car-checklist.md).
