# tesla-mirror — agent guide

Android app that mirrors a dedicated in-car phone into the Tesla Model 3 browser
and injects touches from the Tesla screen back into the phone. No external
server: the phone runs a web server on its hotspot, the car's browser opens it.

## Status

Design stage. No application code yet. See [docs/architecture.md](docs/architecture.md)
for how it will work and [docs/superpowers/specs/](docs/superpowers/specs/) for the
original design rationale and decisions.

## Rules

- Everything in the repo is English: docs, commits, comments, identifiers.
- Commit only complete, meaningful pieces of work. No micro-commits.
  Message: 1–2 lines, says what changed.
- Comments only where the code is non-obvious or needs clarification.
  Self-explanatory code gets no comment.
- Docs are short and cross-linked. Put details in `docs/`, not here.
- Kotlin side is small by design; keep gesture and mapping logic free of
  Android framework dependencies so it stays unit-testable.
- Web side is plain HTML/JS ES modules, no build step, no framework.
- Targets Android 11+ (minSdk 30), stock OS, no root. Do not add
  root-only or Play-Store-only mechanisms.

## Layout

```
AGENTS.md            this file (CLAUDE.md imports it)
app/                 Android app, Kotlin, package com.fortres.teslamirror
web/public/          page served to the Tesla browser (bundled as APK assets)
web/test/            node --test tests for the page modules
tools/               dev scripts (synthetic touch sender, etc.)
docs/                living documentation, see below
```

## Docs

- [architecture.md](docs/architecture.md) — components, data flow, where each lives.
- [protocol.md](docs/protocol.md) — WebSocket messages between page and phone.
- [development.md](docs/development.md) — build, run on emulator, test without the car.
- [device-setup.md](docs/device-setup.md) — one-time setup of the in-car phone and Tesla.
- [car-checklist.md](docs/car-checklist.md) — what to verify in the car in one trip.
- [superpowers/specs/](docs/superpowers/specs/) — dated design specs (decision record).
