# WebSocket protocol

Endpoint: `ws://<phone>:8080/ws`. One JSON object per message. One client at a
time; a new connection closes the previous one.

## Browser → phone

| Message | Fields | Notes |
|---------|--------|-------|
| `offer` | `sdp` | SDP offer from a recvonly `RTCPeerConnection`. |
| `ice` | `candidate` | `RTCIceCandidate.toJSON()`. |
| `touch` | `pts: [{id, x, y}]` | Snapshot of all active fingers. `x,y` in 0..1 relative to the rendered video box. Empty `pts` = all fingers up. Max one message per animation frame. |
| `key` | `k` | `back`, `home` or `recents`. |

```json
{"t":"touch","pts":[{"id":0,"x":0.42,"y":0.71},{"id":1,"x":0.58,"y":0.33}]}
{"t":"key","k":"back"}
```

## Phone → browser

| Message | Fields | Notes |
|---------|--------|-------|
| `state` | `capturing`, `accessibility`, `capture: {w, h}` | Sent on connect and on every change. `capture` is the captured frame size; the page uses only its aspect ratio. |
| `answer` | `sdp` | SDP answer. |
| `ice` | `candidate` | Phone-side ICE candidate (host only). |

```json
{"t":"state","capturing":true,"accessibility":true,"capture":{"w":1440,"h":720}}
```

## Sequence

1. Page opens WS. Phone sends `state`.
2. If `capturing` is true, page sends `offer`; phone replies `answer`; both
   exchange `ice`. Video plays within 1–2 s.
3. Page streams `touch` snapshots and `key` presses.
4. On WS loss the page reconnects with 1–5 s backoff and restarts from step 1.
