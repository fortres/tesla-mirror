# tesla-mirror — agent guide

Android app that mirrors a dedicated in-car phone into the Tesla Model 3 browser
and injects touches from the Tesla screen back into the phone. No external
server: the phone runs a web server on its hotspot, the car's browser opens it.

## Status

Scaffold in place, implementation in progress; see docs/superpowers/plans/.
See [docs/architecture.md](docs/architecture.md) for how it works and
[docs/superpowers/specs/](docs/superpowers/specs/) for the original design
rationale and decisions.

## Golden rule

Code and docs change together. If you change a module's behavior, logic,
protocol, layout or setup steps, update the doc that describes it in the same
piece of work. Check the relevant file in `docs/` before you finish; if no doc
covers what you changed and it matters to the next reader, add it there.

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
- Plans run subagent-driven with per-role models (Sonnet builds, Haiku
  explores, Opus or Fable orchestrates and reviews). See
  [docs/agent-workflow.md](docs/agent-workflow.md).

## Layout

```
AGENTS.md            this file (CLAUDE.md imports it)
.claude/             Claude Code project settings: permissions and the docs-check hook
app/                 Android app, Kotlin, package com.fortres.teslamirror
web/public/          page served to the Tesla browser (bundled as APK assets)
web/test/            node --test tests for the page modules
tools/               dev scripts (synthetic touch sender, etc.)
docs/                living documentation, see below
```

## Docs

- [agent-workflow.md](docs/agent-workflow.md) — execution model, model routing, review moments.
- [architecture.md](docs/architecture.md) — components, data flow, where each lives.
- [protocol.md](docs/protocol.md) — WebSocket messages between page and phone.
- [development.md](docs/development.md) — build, run on emulator, test without the car.
- [device-setup.md](docs/device-setup.md) — one-time setup of the in-car phone and Tesla.
- [car-checklist.md](docs/car-checklist.md) — what to verify in the car in one trip.
- [decisions/](docs/decisions/) — dated records of decisions made after the spec (e.g. a transport change).
- [superpowers/specs/](docs/superpowers/specs/) — original dated design specs; not edited retroactively.
