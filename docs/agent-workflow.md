# Agent workflow

How agents work in this repo: who orchestrates, who implements, who reviews,
and which model does what.

## Execution model

Plans in `docs/superpowers/plans/` are executed subagent-driven: a fresh
implementer subagent per task, a fresh reviewer subagent checks that task
before the next one starts, and a whole-branch review at the end. The
orchestrator never implements a task itself while running a plan.

## Model routing

Every task lands on the cheapest model that does it well.

| Role | Model | Notes |
|------|-------|-------|
| Orchestrator (main session) | Fable or Opus, whichever is active | If the session runs on anything else, switch with `/model opus` before starting. Default is Opus. |
| Implementer subagents | Sonnet | Writes code and tests for one task from the plan. |
| Exploration subagents | Haiku | Read-only sweeps: finding files, reading docs, summarizing. |
| Reviewer subagents | Opus (Fable when the session runs on Fable) | Spec/plan review, per-task code review, final branch review. |

With the Agent tool, pass `model: "sonnet"`, `"haiku"` or `"opus"` explicitly;
do not rely on the default.

## When the strong model must step in

Three moments, no exceptions:

1. Before a plan locks: review spec and plan before implementation starts.
2. When the same error shows up twice: stop retrying on the cheap model and
   hand the problem to the reviewer model with the full context.
3. Before calling work done: final review of the whole change.

## Conventions

Rules for commits, docs and comments are in [../AGENTS.md](../AGENTS.md).
The docs-check hook in `.claude/hooks/` warns on commits that change code
without touching docs.
