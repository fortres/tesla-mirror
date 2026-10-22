# In-car phone setup

One-time setup for the dedicated car phone, always charging. Pick your
platform: [Android](#android) or [iPhone](#iphone). Tesla side is the same for
both (last step of each).

## Android

Android 11+. The phone can lie anywhere; no landscape mount is needed.

1. Install the APK: `adb install android/app/build/outputs/apk/debug/app-debug.apk` or open the file on the phone.
2. Settings → Accessibility → enable tesla-mirror. Never force-stop the app: Android
   then disables the service and you must re-enable it.
3. Settings → Apps → tesla-mirror → Battery → unrestricted. Allow autostart if
   the OEM has such a switch.
4. Developer options → enable "Stay awake while charging".
5. Hotspot on. Settings → Hotspot → disable "Turn off hotspot automatically".
   Mobile data, a SIM, and internet access are not required for the Tesla to
   connect to the phone and open the local mirror page.
6. Pair the phone with the Tesla over Bluetooth. The phone becomes the Tesla
   phone: audio and incoming calls go through the car natively. Put a SIM in the
   phone or forward the main number to it if calls are needed.
7. Sign in to Waze, Telegram, YouTube on the phone. Open the app and turn on
   "Force landscape" (grant "Modify system settings" once, then flip the switch
   again). It is a system setting, so it stays on across app restarts and
   reboots until you switch it off. Apps that only support portrait still show
   as a tall image in the middle of the Tesla screen; that is expected.
8. Open the app, tap Start, accept screen capture.
9. In the Tesla: connect Wi-Fi to the phone's hotspot, open the browser at the
   URL shown in the app (`http://<phone-ip>:8080`), bookmark it. Re-check it after
   a reboot: Android may pick a different hotspot subnet. With the hotspot on,
   the app should show the current URL; wait up to 10 seconds for it to refresh.
   If the app says "hotspot address unavailable", check that the hotspot is on;
   the phone can still provide the local connection without mobile internet.

After a phone reboot the service starts itself (the web page is already
reachable) and its notification opens the app. Only step 8 repeats: Android 11
cannot grant screen capture without a tap.

## iPhone

View-only. Build and install first: [ios.md](ios.md).

1. Install the app with SideStore (free Apple ID; it re-signs weekly while the
   phone and SideStore can reach each other).
2. Settings -> Personal Hotspot on. Allow others to join.
3. Settings -> Display & Brightness -> Auto-Lock -> Never (the broadcast stops
   when the phone locks). Keep the phone charging.
4. Pair the phone with the Tesla over Bluetooth for audio and calls.
5. Open the app, tap the broadcast button, choose Tesla Mirror, Start
   Broadcast. Repeat once per drive (also from Control Center).
6. In the Tesla: connect Wi-Fi to the hotspot, open `http://172.20.10.1:8080`
   (the app detects and shows the actual `bridge*` address, with
   `172.20.10.1` as a fallback), bookmark it. Mobile data and internet access
   are not required for the local mirror connection.
