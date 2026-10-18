# iOS video: H.264 over WebSocket, played through MSE

Date: 2026-10-19

## Context

- iOS has no touch injection API, so the iPhone is view-only.
- A Broadcast Upload Extension is limited to about 50 MB; a WebRTC stack inside
  it is risky.
- The Tesla browser is Chromium 140+. WebCodecs exists only in secure contexts
  and the page is plain http on a LAN address, so it is unusable.
  Media Source Extensions work over http.

## Decision

The extension encodes H.264 with VideoToolbox and sends Annex B access units as
binary WebSocket frames ([protocol.md](../protocol.md)). The page muxes each
frame into fragmented MP4 (`web/public/fmp4.js`) and plays it through MSE
(`h264.js`). Android keeps WebRTC.

## Consequences

- TCP can build latency. The extension measures the socket backlog with
  WebSocket ping/pong and drops frames over 1 MB, including keyframes over
  that size, then waits for the next keyframe. The page drops frames when more
  than 2 wait for decode.
- The page appends on a gapless 33 ms timeline and seeks to the live edge when
  playback lags; verify latency in the car ([car-checklist.md](../car-checklist.md#iphone)).
- Fallback if MSE adds too much latency or the car rejects it: WebRTC inside
  the extension, reusing `peer.js`.
