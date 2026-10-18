# Hotspot subnet is not stable

Date: 2026-10-18

Android 11 may pick a random 192.168.x.0/24 subnet on each tethering start, so
the phone address, and with it the bookmarked URL, can change.

Decision for v1: the app shows the current URL and the user re-checks it
against the Tesla bookmark after a phone reboot ([device-setup.md](../device-setup.md),
[car-checklist.md](../car-checklist.md) item 12).

Candidates for v1.1:

- mDNS name via `NsdManager` (needs a test in the Tesla browser).
- A dedicated car Wi-Fi router with a DHCP reservation for the phone.
