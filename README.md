# tesla-mirror

Mirror an Android phone or an iPhone into the Tesla browser. Android can also be controlled by touch from the Tesla; the iPhone is view-only.

## What it does

- Shows the phone screen in the Tesla browser over the phone's hotspot.
- Runs on the phone: no external server, nothing leaves the LAN.
- Android: sends touches, multi-finger gestures and Back/Home/Recents from the Tesla screen back to the phone, and a "Force landscape" switch makes landscape-capable apps fill the Tesla screen.
- iPhone: view-only (iOS has no touch injection API); you operate the phone itself.

## How it works

The phone runs a web server on its hotspot and streams the screen as H.264 to
the page in the Tesla browser: over WebRTC on Android, over WebSocket (muxed to
MP4 in the page, played with Media Source Extensions) on iPhone. On Android the
page sends touches over a WebSocket and an AccessibilityService injects them.
Details: [docs/architecture.md](docs/architecture.md),
[docs/android.md](docs/android.md), [docs/ios.md](docs/ios.md).

## Status

Android: verified end to end on an Android 11 emulator. iPhone: page path
verified on Linux with a fake stream, extension not yet built on a Mac. First
car test pending for both, see [docs/car-checklist.md](docs/car-checklist.md).

## Requirements

- Tesla with the browser usable while driving.
- Android: Android 11+ phone; Android Studio, or Gradle + JDK 17.
- iPhone: iOS 17+ (target iPhone 15 Pro, iOS 26); a Mac with Xcode 26+ and XcodeGen to build; SideStore with a free Apple ID to install.
- Node 22 for web tests.

## Quick start

- Android: `cd android && ./gradlew installDebug`, then [docs/device-setup.md](docs/device-setup.md#android).
- iPhone: build on a Mac per [docs/ios.md](docs/ios.md), then [docs/device-setup.md](docs/device-setup.md#iphone).

## Development

See [docs/development.md](docs/development.md).

## Contributing

Rules for contributors and agents: [AGENTS.md](AGENTS.md).

## Known limitations

- Both: the hotspot subnet may change after a reboot (Android); re-check the URL. Audio goes through Bluetooth, not the mirror.
- Android: portrait-only apps show as a tall image; a static screen sends no frames.
- iPhone: no control from the Tesla; the broadcast must be started by hand each drive and stops when the phone locks; no force-landscape switch (portrait apps stay portrait); the free Apple ID needs re-signing every 7 days (SideStore).
