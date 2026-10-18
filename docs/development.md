# Development

Everything except Tesla-browser quirks can be developed and tested on a laptop.

## Requirements

- Android Studio with an API 30 (Android 11) emulator image.
- JDK 17 on the machine: the build pins `jvmToolchain(17)` and does not download a toolchain.
- Node 22+ for web tests and dev scripts (built-in WebSocket).

```
sdkmanager "system-images;android-30;google_apis;x86_64"
avdmanager create avd -n tesla-mirror -k "system-images;android-30;google_apis;x86_64" -d pixel_2_xl
```

## Run on the emulator

1. Start the API 30 emulator.
2. Build and install `app` from Android Studio (or `./gradlew installDebug`).
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
adb push web/public/. /sdcard/Android/data/com.fortres.teslamirror/files/web/
```

The folder is checked once at server start, so restart the app process after
pushing it (not by force-stop, which also disables the accessibility service;
if you force-stop, re-enable it, see the checklist below).
Delete that folder to go back to the bundled page. There is no in-app toggle.
Not for the car phone.

## Tests

- Kotlin: `./gradlew test`. Covers coordinate mapping and clamping,
  `GestureStreamer` snapshot → segments, message parsing.
- Web: `cd web && node --test`. Covers normalization with letterbox and touch
  coalescing. The same ES modules run in the browser and in node.
- Synthetic touch: `node tools/tap.mjs <x> <y> [host:port]` (x, y in 0..1,
  default `localhost:8080`) connects to `/ws` and sends a tap to confirm
  injection reaches the emulator. Exit codes: 0 sent, 1 cannot connect (5 s) or closed before the release, 2 bad arguments.

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
  `adb shell settings put secure enabled_accessibility_services com.fortres.teslamirror/com.fortres.teslamirror.input.InputService; adb shell settings put secure accessibility_enabled 1`.
- Debug overlay shows fps, bitrate, ICE state, last touches.

Real-car verification is a separate trip: [car-checklist.md](car-checklist.md).
