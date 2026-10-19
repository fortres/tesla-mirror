# WebSocket protocol

Endpoint: `ws://<phone>:8080/ws`. One JSON object per message. One client at a
time; a new connection closes the previous one.

## Browser → phone

| Message | Fields | Notes |
|---------|--------|-------|
| `offer` | `sdp` | SDP offer from a recvonly `RTCPeerConnection`. |
| `ice` | `candidate` | `RTCIceCandidate.toJSON()`. |
| `touch` | `pts: [{id, x, y}]` | Snapshot of all active fingers. `x,y` in 0..1 relative to the rendered video box. Empty `pts` = all fingers up. Max one message per animation frame; while fingers are down the page repeats the latest snapshot at least every 100 ms, and the phone releases all fingers after 500 ms without a snapshot. |
| `key` | `k` | `back`, `home` or `recents`. |

```json
{"t":"touch","pts":[{"id":0,"x":0.42,"y":0.71},{"id":1,"x":0.58,"y":0.33}]}
{"t":"key","k":"back"}
```

## Phone → browser

| Message | Fields | Notes |
|---------|--------|-------|
| `state` | `capturing`, `accessibility`, `capture: {w, h}`, `transport`, `touch` | Sent on connect and on every change. `capture` is the captured frame size; the page uses it for the aspect ratio (`webrtc`) and as the MP4 track size (`h264ws`). `transport`: `webrtc` (offer/answer, video track) or `h264ws` (binary frames on this socket, see below). `touch`: whether the phone accepts `touch` and `key` messages; `false` means the page hides the key buttons and ignores touches. |
| `answer` | `sdp` | SDP answer. |
| `ice` | `candidate` | Phone-side ICE candidate (host only). |

```json
{"t":"state","capturing":true,"accessibility":true,"capture":{"w":1440,"h":720},"transport":"webrtc","touch":true}
```

## Binary video frames (`transport: h264ws`)

Phone → browser binary WebSocket messages: a 16-byte header, then one H.264
Annex B access unit (3- or 4-byte start codes). A message shorter than 16
bytes or with version ≠ 1 is dropped by the receiver; the socket stays open.

| Bytes | Field |
|-------|-------|
| 0 | version, `1` |
| 1 | flags, bit 0 = keyframe; bits 1–7 zero, receivers ignore them |
| 2–3 | zero |
| 4–11 | pts in microseconds, unsigned little-endian, from any monotonic origin chosen by the phone, strictly increasing within one connection |
| 12–15 | zero |

Golden vector (keyframe, pts 1_000_000 µs):
`01 01 00 00 40 42 0f 00 00 00 00 00 00 00 00 00`

- Every keyframe carries SPS and PPS in front of the IDR slice.
- On every new WebSocket client the phone sends `state`, then starts with a
  keyframe (forces one).
- The page sends nothing to an `h264ws` phone besides opening the socket (no
  `offer`, `ice`, `touch` or `key`).

## HTTP

`GET /health` (iOS only) returns `{"capturing":bool}`.

## Sequence

1. Page opens WS. Phone sends `state`.
2. If `capturing` is true and `transport` is `webrtc`, page sends `offer`; phone replies `answer`; both
   exchange `ice`. Video plays within 1–2 s. If `transport` is `h264ws`, the
   phone pushes binary frames while `capturing`.
3. If `touch` is true, the page streams `touch` snapshots and `key` presses.
4. On WS loss the page reconnects with 1–5 s backoff and restarts from step 1.
