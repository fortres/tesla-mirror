# Car checklist

Everything to verify in one trip to the car. Sections: [Android](#android),
[iPhone](#iphone). Shared first steps are in the Android list.

## Android

Collect logs afterwards with `adb logcat -s TeslaMirror`.

Before leaving: phone set up per [device-setup.md](device-setup.md#android),
app running, capture started, hotspot on. Mobile data is not needed for the
local mirror connection.

1. Tesla Wi-Fi connects to the phone hotspot and stays connected.
2. Browser opens the page. Note whether the browser is usable while driving
   (not in Park) on this firmware and region.
3. Video plays. If not, enable the debug overlay and note WS state, ICE state
   and any error. This decides WebRTC vs the MJPEG fallback. Check
   `adb logcat -s TeslaMirror` for `video codec: H264` (the emulator uses VP8).
4. Latency: tap the clock on the phone and count frames on the Tesla; target
   under ~200 ms.
5. Touch: tap, swipe, long press. Debug overlay shows raw touch ids and
   coordinates.
6. Two fingers: pinch on the map. Check the overlay reports two distinct ids;
   if not, note how the Tesla browser reports the second finger.
7. Back/Home/Recents buttons.
8. Pull the phone's USB cable for a minute: battery drain and warmth with
   capture running.
9. Bluetooth: Waze voice, Telegram notification sound, an incoming call shown
   on the Tesla screen.
10. Accessibility service stays enabled after the app is restarted; the page
    shows no "No touch" badge. If it is off, re-enable it per
    [device-setup.md](device-setup.md) step 2.
11. Turn the car off and on: hotspot reconnects, page recovers from the
    bookmark without re-pairing anything.

12. Reboot the phone twice: compare the full address shown in the app with the
    bookmark each time, not only the third number.
13. Rotation: switch Waze (landscape) to a portrait-only app and back; touch
    still lands in both.
14. Force landscape on: Waze renders horizontally while the phone lies
    portrait; off: auto-rotate comes back.
15. Bitrate cap: overlay kbps stays at or below ~4000 under motion.
16. Known issue: a static phone screen shows no new frames; the page says
    "Waiting for first frame" until something moves.

Record results in this file or an issue; update constants in `ScreenSource` if
bitrate or resolution needs tuning.

## iPhone

Before leaving: phone set up per [device-setup.md](device-setup.md#iphone),
broadcast started, Personal Hotspot on.

1. Tesla joins the hotspot; the page opens at the address shown in the app
   (usually `http://172.20.10.1:8080`). Browser usable while driving, as above.
2. Debug overlay shows `transport: h264ws` and `decoder: yes`. If `decoder: no`,
   note the codec string; fallback is WebRTC in the extension
   ([decision](decisions/2026-10-19-ios-h264-over-websocket.md)).
3. Latency: tap the clock, count frames; target under ~300 ms and no growth over
   minutes. Overlay `dropped` stays low.
4. Picture survives app switching on the phone, and a static screen still shows
   a picture after reconnect.
5. Broadcast stops when the phone locks (Auto-Lock Never prevents it); page then
   says "Reconnecting…" with "If it does not come back, start the broadcast on
   the iPhone".
6. Extension memory: after a long run, check the device log, category
   `broadcast`, for memory warnings or a killed extension.
7. Rotation: open a landscape app; the picture is upright. If sideways, flip the
   rotation mapping in `FrameRotator` ([ios.md](ios.md)).
8. Bluetooth: audio and an incoming call work through the Tesla.
9. Car off and on: hotspot reconnects; restart the broadcast if it stopped.
