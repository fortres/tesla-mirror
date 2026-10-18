# tesla-mirror

Mirror a dedicated in-car Android phone into the Tesla browser and control it by touch.

## What it does

- Shows the phone screen in the Tesla browser over the phone's hotspot.
- Sends touches, multi-finger gestures and Back/Home/Recents from the Tesla screen back to the phone.
- Runs fully on the phone: no external server, nothing leaves the LAN.
- "Force landscape" switch makes landscape-capable apps fill the Tesla screen, however the phone lies.

## How it works

The phone runs a web server on its hotspot and streams the screen as H.264 over
WebRTC. The page in the Tesla browser sends touches over a WebSocket, and an
AccessibilityService injects them as gestures. Details:
[docs/architecture.md](docs/architecture.md).

## Status

v1: verified end to end on an Android 11 emulator; first car test pending, see
[docs/car-checklist.md](docs/car-checklist.md).

## Requirements

- Android 11+ phone.
- Tesla with the browser usable while driving.
- Android Studio, or Gradle + JDK 17.
- Node 22 for web tests.

## Quick start

Build and install the app (`./gradlew installDebug`), then follow
[docs/device-setup.md](docs/device-setup.md).

## Development

See [docs/development.md](docs/development.md).

## Contributing

Rules for contributors and agents: [AGENTS.md](AGENTS.md).

## Known limitations

- The hotspot subnet may change after a reboot; re-check the URL.
- Portrait-only apps show as a tall image.
- A static screen sends no frames.
- Audio goes through Bluetooth, not the mirror.
