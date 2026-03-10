# Plan: Subagents as Subprocess mc Sessions

## Problem

The current in-process subagent runner is a second-class implementation of the agent loop:

- Subagents are less capable than the main agent (different system prompt path, tools stripped)
- Subagents don't reliably know their working directory — they guess, causing cascading failures
- Subagents can't spawn subagents (the tool is stripped at depth > 0)
- Ralph mode is broken inside subagents (the loop logic behaves differently in the stripped-down runner)
- The runner duplicates agent bootstrap logic: system prompt building, model resolution, tool set assembly
- Worktree lifecycle is fragile — changes can be lost when merge or cleanup ordering goes wrong

## Goal

Replace `subagent-runner.ts` with a subprocess that launches a fresh `mc` process. A subagent becomes a real mini-coder session, not a stripped-down approximation of one.

---

## Behaviour Changes

### What stays the same (user-visible)

- `@agent-name` in a prompt delegates to a custom agent — same syntax, same config format
- Custom agent frontmatter (`model`, system prompt body) is still respected
- Custom commands fan out to subagents
- Git isolation per subagent is preserved
- Token counts are still aggregated and shown

### What improves (user-visible)

- **Subagents are fully capable** — same system prompt, same tools, same loop as the main agent
- **Subagents can spawn subagents** — no artificial nesting limit
- **Working directory is always correct** — the subprocess is launched with an explicit `--cwd`
- **Ralph mode works inside subagents** — it's just a full session flag
- **ESC kills the whole chain** — the interrupt signal propagates to every active subprocess

### What gets removed

- `execution: inline` on custom commands — this was a workaround for worktree issues which the new model resolves. All commands run as subprocesses. Community configs that used `execution: inline` will fall back to subprocess execution.

---

## Prompt Chain

Each mc subprocess assembles its system prompt in this order:

1. **Internal prompt** — mini-coder's own instructions (tools, guidelines, date/cwd)
2. **Global context file** — `~/.agents/AGENTS.md` (or `CLAUDE.md`)
3. **Local context file** — `.agents/AGENTS.md` (or `CLAUDE.md`, or `AGENTS.md` at repo root)
4. **Custom agent prompt** — the markdown body from the agent config file (if `--agent <name>` was passed)

The **command prompt** (expanded template from e.g. `/review` or a custom command) becomes the first user message — it is not part of the system prompt.

Note: the current `loadContextFile` only loads the first file it finds. It must be fixed to load both global and local, composing them in order, so project-level context does not silently shadow global context.

---

## System Prompt: Avoiding Infinite Delegation

The current guidelines actively encourage delegation:

> "Use subagents for all tasks that require a lot of context..."
> "Keep your context clean and focused on the user request, use subagents to achieve this."

This causes models to delegate continuously without doing any actual work. The guidelines need to be rebalanced:

- **Main agent**: "Use the `subagent` tool sparingly — only for clearly separable, self-contained subtasks that benefit from a fresh context window. Prefer doing the work directly."
- **Subagent sessions** (detected via a `--subagent` flag): stronger wording — "You are running as a subagent. Complete the task you have been given directly using your tools. Do not spawn further subagents unless the subtask is unambiguously separable and self-contained."

---

## Communication Protocol

The parent needs structured data back from the subprocess. A **dedicated pipe on fd 3** is used — this keeps stdout/stderr free and avoids temp file lifecycle issues.

The parent opens the write end and passes it as fd 3 to the subprocess. Before exiting, the subprocess writes a single JSON line:

```ts
interface SubagentSummary {
  result: string;          // final assistant text from the session
  inputTokens: number;
  outputTokens: number;
  worktreeBranch?: string; // git branch the subprocess worked on
}
```

Merge conflict/blocked status is no longer part of the subprocess result — see Worktrees below.

---

## Output / UI

The current subagent output is noisy and not useful. New model:

- **On launch**: one line — `⇢ subagent [laneId] — <truncated prompt>`
- **While running**: spinner in the parent ("thinking...")
- **On completion**: one line — `← subagent [laneId] done (Nin / Nout tokens)`
- **Subprocess's own terminal output is suppressed** — the subprocess runs in headless mode (no spinner, no status bar). Its `result` text is returned to the calling LLM via the fd 3 pipe.

---

## Worktrees

### Model

Every subprocess creates and owns its own worktree:

1. Subprocess is launched with `--cwd <parentCwd>`
2. Subprocess creates a git worktree from `parentCwd` on a new branch (`mc-sub-<laneId>`)
3. Subprocess does its work inside the worktree
4. Before exit, subprocess removes the worktree directory and writes the branch name in the fd 3 summary
5. Parent receives the branch name, **merges it into its own working tree**, then deletes the branch

The subprocess never merges — it only creates and cleans up its own worktree directory. The parent owns all merging. This eliminates the merge-lock complexity inside subprocesses and makes merge ordering deterministic in the parent.

### Merge conflicts

If the parent's merge produces conflicts, it surfaces them to the LLM as it does today (conflict file list in the tool result). The LLM can resolve them or report to the user.

### Non-git projects

Unchanged — no worktree is created and the subprocess works directly on the `cwd`.

---

## Interrupt Propagation

When the user hits `ESC`:

- The parent sends `SIGTERM` to all active subprocess PIDs it is tracking
- Each subprocess, on receiving `SIGTERM`, cleans up its own worktree directory (branch is left for the parent to handle or discard), then exits
- The parent discards any pending merge for interrupted subagents and cleans up their branches

---

## What Gets Removed

| Item | Reason |
|---|---|
| `subagent-runner.ts` | Replaced by a thin subprocess launcher |
| `depth` parameter | No longer needed — subagents are full sessions |
| `.filter(tool => tool.name !== "subagent")` guard | Subagents have the full tool set |
| Manual `buildSystemPrompt` / `buildToolSet` in runner | Done by the subprocess itself |
| Manual model resolution in runner | Passed as `--model` CLI flag |
| `execution: inline` in custom commands | Removed — all commands use subprocess execution |
| Merge lock in runner | Merges happen in the parent only, sequentially per-lane |

---

## Recursion Cap

An env-var based cap (`MC_SUBAGENT_DEPTH`, max 10) is retained as a safety rail against runaway delegation chains. Unlike the old in-process `depth` parameter it is not a first-class concern of the runner — it is a background guard. Subagents that hit the cap receive a clear error. In practice the cap is generous enough that it should never be reached in normal use.
