#!/usr/bin/env bash
# PreToolUse hook: warn when code under app/ or web/ is about to be committed
# without any change under docs/. Never blocks; output is advice for the agent.
set -u
cmd=$(jq -r '.tool_input.command // empty')
case "$cmd" in *"git commit"*) ;; *) exit 0 ;; esac

changed=$( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } 2>/dev/null | sort -u )
code=$(printf '%s\n' "$changed" | grep -E '^(app|web|tools)/' || true)
docs=$(printf '%s\n' "$changed" | grep -E '^(docs/|AGENTS\.md)' || true)

if [ -n "$code" ] && [ -z "$docs" ]; then
  msg="Golden rule check: code changed under app/, web/ or tools/ but nothing under docs/ or AGENTS.md. Confirm the relevant doc (architecture, protocol, development, setup) still matches before committing, or update it in this commit."
  jq -cn --arg m "$msg" '{systemMessage:$m, hookSpecificOutput:{hookEventName:"PreToolUse", additionalContext:$m}}'
fi
exit 0
