# Boot starts the service, not the activity

## Context

Android 10+ blocks activity launches from background broadcasts such as
`BOOT_COMPLETED`, so the earlier plan (BootReceiver opens MainActivity) does
not work on the target phone. Screen capture also cannot be granted without a
user tap.

## Decision

`BootReceiver` starts `MirrorService` as a foreground service (`specialUse`
type, no capture). The service serves the page and shows a notification whose
tap opens `MainActivity`. The user still taps Start once per boot to grant
screen capture.

## Consequences

- After reboot the page is reachable immediately and shows "Tap Start on phone".
- One tap on the notification and one on Start are needed per boot.
- Capture starts only from the activity (`mediaProjection` foreground type is
  entered when the consent result arrives).
- Needs the `RECEIVE_BOOT_COMPLETED` permission and, on some OEMs, autostart
  allowed ([device-setup.md](../device-setup.md)).
