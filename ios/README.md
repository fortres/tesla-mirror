# iOS app

`TeslaMirror/` is the SwiftUI host app, `TeslaMirrorBroadcast/` the broadcast extension, `MirrorCore/` the SwiftPM package with platform-independent logic.
`project.yml` is the XcodeGen definition; the `.xcodeproj` is generated and not committed.
Generate it on macOS with `xcodegen generate`, then open `TeslaMirror.xcodeproj` and set your team under Signing.
The extension bundles `web/public` as the `public` folder.
Setup and architecture: [docs/ios.md](../docs/ios.md).
