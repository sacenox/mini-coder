# Plan: Subagents as Subprocess mc Sessions

## Problem

The current in-process subagent runner has fundamental issues that stem from it being a second-class implementation of the agent loop:

- Subagents are less capable than the main agent (different system prompt path, tools stripped)
- Subagents don't reliably know their working directory — they guess, causing cascading failures
- Subagents can't spawn subagents (the tool is stripped at depth > 0)
- Ralph mode is broken inside subagents (the loop logic behaves differently in the stripped-down runner)
- The runner duplicates agent bootstrap logic: system prompt building, model resolution, tool set assembly

## Goal

Replace `subagent-runner.ts` with a subprocess that launches a fresh `mc` process. A subagent becomes a real mini-coder session, not a stripped-down approximation of one.

## Behaviour Changes

### What stays the same (user-visible)

- `@agent-name` in a prompt delegates to a custom agent — same syntax, same config format
- Custom agent frontmatter (`model`, system prompt body) is still respected
- Custom commands with `execution: subagent` still fan out to subagents
- `execution: inline` commands are unaffected
- Git worktree isolation per subagent is preserved
- Merge conflict / merge-blocked messages surface to the user unchanged
- Token counts are still aggregated and shown

### What changes (user-visible)

- **Subagents are fully capable** — same system prompt, same tools, same loop as the main agent. No more degraded output.
- **Subagents can spawn subagents** — no artificial nesting limit.
- **Working directory is always correct** — the subprocess is launched with the right `cwd`; no path guessing.
- **Ralph mode works inside subagents** — it's just a full session flag.
- **Custom agents get their own full session** — a `model` override in frontmatter now controls a complete `mc` session, not just the LLM call inside a stripped runner.

## Communication Protocol

The parent needs structured data back from the subprocess:

| Field | Description |
|---|---|
| `result` | Final assistant text from the session |
| `inputTokens` | Total input tokens consumed |
| `outputTokens` | Total output tokens consumed |
| `mergeConflict` | Branch + conflict file list if merge had conflicts |
| `mergeBlocked` | Branch + conflict file list if merge was deferred |

**Approach:** The subprocess writes a JSON summary to a temp file whose path is passed as a CLI flag (e.g. `--output-summary <path>`). The parent reads and parses it after the subprocess exits. This keeps stdout/stderr free for live terminal output piped through to the parent.

## Custom Agent / Command Compatibility

| Feature | Current | After |
|---|---|---|
| `@agent-name` | Loads config, overrides system prompt in-process | Passes `--agent <name>` to `mc` subprocess; config loaded there |
| `model` frontmatter | Overrides model string passed to `runTurn` | Passed as `--model` to the subprocess |
| Custom command `execution: subagent` | Expands template, calls `runSubagent()` | Expands template, launches `mc --prompt "..."` |
| Custom command `execution: inline` | Runs in main agent context | Unchanged |

Community configs (`.agents/agents/`, `~/.agents/agents/`) continue to work without modification — the subprocess loads them from the same paths.

## What Gets Removed

- `subagent-runner.ts` — replaced by a thin subprocess launcher
- The `depth` parameter on `runSubagent` — no longer needed
- The `.filter((tool) => tool.name !== "subagent")` guard — subagents have the full tool set
- Manual `buildSystemPrompt` / `buildToolSet` calls in the runner
- Manual model resolution in the runner

## Open Questions

1. **Live output streaming** — should the parent pipe the subprocess's terminal output through as-is, or prefix/indent it to show nesting depth? Current in-process rendering already uses lane labels; a similar approach should work with piped output.
2. **Worktree ownership** — does the parent create the worktree and pass `--cwd <worktreePath>` to the subprocess, or does the subprocess own the worktree lifecycle? Parent ownership keeps merge-lock logic centralised.
3. **Non-git projects** — behaviour unchanged; no worktree is created and the subprocess just uses the same `cwd`.
4. **Interrupt propagation** — if the user hits `ESC` in the parent, the signal should be forwarded to the active subprocess.
