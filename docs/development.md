# Development

Everything except Tesla-browser quirks can be developed and tested on a laptop.

## Requirements

- Android Studio with an API 30 (Android 11) emulator image.
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
   the screen capture dialog.
4. `adb forward tcp:8080 tcp:8080`
5. Open `http://localhost:8080` in desktop Chrome. DevTools device mode gives
   touch events; pinch is Shift + drag.

The emulator uses a software H.264 encoder, so quality and latency are worse
than on a real phone. That is fine for development.

## Dev mode for the web page

The server serves the page from a folder on the device instead of APK assets
when that folder exists, so the page can be iterated without rebuilding:

```
adb push web/public/. /sdcard/Android/data/com.fortres.teslamirror/files/web/
```

Delete that folder to go back to the bundled page. There is no in-app toggle.
Not for the car phone.

## Tests

- Kotlin: `./gradlew test`. Covers coordinate mapping with rotation,
  `GestureStreamer` snapshot → segments, message parsing.
- Web: `cd web && node --test`. Covers normalization with letterbox and touch
  coalescing. The same ES modules run in the browser and in node.
- Synthetic touch: `node tools/tap.mjs <x> <y>` connects to `/ws` and sends a
  tap at normalized coordinates to confirm injection reaches the emulator.

## Manual checklist (laptop)

- Page shows "Tap Start on phone" before capture, video after Start.
- Tap, swipe, long press, pinch in DevTools device mode act on the emulator.
- Back/Home/Recents buttons work.
- Kill the app: page shows reconnecting, recovers after restart without reload.
- Debug overlay shows fps, bitrate, ICE state, last touches.

Real-car verification is a separate trip: [car-checklist.md](car-checklist.md).
