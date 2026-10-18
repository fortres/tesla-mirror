# In-car phone setup

One-time setup for the dedicated car phone (Android 11+, always charging,
mounted landscape).

1. Install the APK: `adb install app-release.apk` or open the file on the phone.
2. Settings → Accessibility → enable tesla-mirror. Never force-stop the app: Android
   then disables the service and you must re-enable it.
3. Settings → Apps → tesla-mirror → Battery → unrestricted. Allow autostart if
   the OEM has such a switch.
4. Developer options → enable "Stay awake while charging".
5. Hotspot on. Settings → Hotspot → disable "Turn off hotspot automatically".
6. Pair the phone with the Tesla over Bluetooth. The phone becomes the Tesla
   phone: audio and incoming calls go through the car natively. Put a SIM in the
   phone or forward the main number to it if calls are needed.
7. Sign in to Waze, Telegram, YouTube on the phone. Turn system auto-rotate
   on so apps follow the landscape mount. Apps that only support portrait
   show as a tall image in the middle of the Tesla screen; that is expected.
8. Open the app, tap Start, accept screen capture.
9. In the Tesla: connect Wi-Fi to the phone's hotspot, open the browser at the
   URL shown in the app (shown in the app, `http://<phone-ip>:8080`), bookmark it. Re-check it after
   a reboot: Android 11 may pick a different hotspot subnet.

After a phone reboot the service starts itself (the web page is already
reachable) and its notification opens the app. Only step 8 repeats: Android 11
cannot grant screen capture without a tap.
