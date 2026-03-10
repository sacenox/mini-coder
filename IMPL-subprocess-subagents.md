# Implementation Plan: Subprocess Subagents

> Design spec: `PLAN-subprocess-subagents.md`

Five sequential phases. Each phase leaves the repo in a working, tested state.
Phases 1, 2, and 5 are good ralph candidates. Phases 3 and 4 touch the core
subprocess/worktree boundary and require manual oversight.

---

## Phase 1 — Headless mc mode

**Goal:** `mc` can be launched as a non-interactive subprocess that runs a single
prompt and writes a structured result to a file descriptor before exiting.

**New CLI flags:**

| Flag | Description |
|---|---|
| `--subagent` | Headless mode: no banner, no interactive loop, no spinner, no status bar |
| `--agent <name>` | Load a custom agent config (system prompt + optional model override) |
| `--output-fd <n>` | File descriptor to write the JSON result to before exit |

`--cwd`, `--model`, and positional prompt already exist and work unchanged.

**Changes:**

- Add `--subagent`, `--agent`, `--output-fd` to `parseArgs` in `src/index.ts`
- Add a `HeadlessReporter` (implements `AgentReporter`) that no-ops all UI methods
- When `--subagent` is set: use `HeadlessReporter`, skip banner, skip input loop,
  run a single `runner.processUserInput(prompt)` then exit
- Before exit, write `SubagentSummary` JSON to the specified fd:
  ```ts
  interface SubagentSummary {
    result: string;
    inputTokens: number;
    outputTokens: number;
    worktreeBranch?: string; // Phase 4
  }
  ```
- `--agent` loads the agent config from `.agents/agents/` (reuse `loadAgents`),
  passes its `systemPrompt` and `model` override into `runAgent`

**Exit criteria:**
- `bun run src/index.ts --subagent --prompt "say hello" --output-fd 1` prints
  valid JSON to stdout
- All existing tests pass
- No interactive mode regressions

---

## Phase 2 — Prompt chain + system prompt

**Goal:** Correct context file composition and balanced delegation language.

**Changes:**

- Fix `loadContextFile` in `src/agent/system-prompt.ts`:
  - Load global (`~/.agents/AGENTS.md` / `CLAUDE.md`) **and** local
    (`.agents/AGENTS.md`, `CLAUDE.md`, `AGENTS.md` at repo root) independently
  - Compose both into the system prompt in order: global first, then local
  - Neither silently shadows the other
- Update delegation guidelines in the system prompt:
  - Main agent: *"Use the `subagent` tool sparingly — only for clearly separable,
    self-contained subtasks. Prefer doing the work directly."*
  - Subagent mode (`--subagent` flag): stronger wording appended — *"You are
    running as a subagent. Complete the task directly using your tools. Do not
    delegate to further subagents unless the subtask is clearly separable and
    self-contained."*
- Custom agent system prompt (from `--agent`) appended after local context file,
  before the user message

**Exit criteria:**
- Unit tests for `buildSystemPrompt` covering: no context files, global only,
  local only, both, and subagent mode
- All existing tests pass

---

## Phase 3 — Subprocess launcher (replaces subagent-runner)

**Goal:** The `subagent` tool spawns a real `mc` subprocess instead of running
in-process. Worktrees are temporarily disabled in this phase to keep the diff
focused. Non-git projects are unaffected.

**Changes:**

- Replace `src/agent/subagent-runner.ts` with a subprocess launcher:
  - Create a pipe pair; pass the write end as `--output-fd <n>` to the child
  - Spawn `mc --subagent --cwd <cwd> --model <model> [--agent <name>] <prompt>`
  - Read the write end after the child exits; parse `SubagentSummary`
  - Return `SubagentOutput` from the parsed summary
- Remove `depth` parameter from `runSubagent` signature
- Remove `.filter(tool => tool.name !== "subagent")` guard — subagents get the
  full tool set
- Track active subprocess PIDs for interrupt propagation (Phase 5)
- Worktrees: skipped in this phase — subprocess receives the parent `cwd` directly.
  Any worktree code in the old runner is removed but not yet replaced.

**⚠ Manual phase** — don't ralph this. Verify by running a real subagent task
end-to-end and checking the result comes back correctly.

**Exit criteria:**
- `@writer` (or any custom agent) delegates correctly via subprocess
- A custom command runs correctly via subprocess
- Token counts are reported in the completion line
- All tests pass (worktree-specific tests may need updating/removal)

---

## Phase 4 — New worktree model

**Goal:** Subprocess creates and owns its worktree; parent owns all merging.
Fixes the fragile lifecycle that could lose changes.

**New model:**
1. Subprocess creates a git worktree from `parentCwd` on branch `mc-sub-<laneId>`
2. Subprocess works inside the worktree
3. Before exit, subprocess removes the worktree *directory* (keeps the branch)
   and includes `worktreeBranch` in the fd result
4. Parent receives the branch name and merges it into its own working tree
5. Parent deletes the branch after a successful merge
6. On merge conflict: parent returns conflict file list in the tool result (same
   UX as today)
7. Merge lock lives in the parent only — sequential per active lane, no lock
   needed inside subprocesses

**Changes:**

- Add worktree lifecycle into the subprocess (create on start, remove dir on exit)
- Add `worktreeBranch` to `SubagentSummary`
- Move merge + branch cleanup into the subprocess launcher (parent side)
- Remove the old merge lock from `subagent-runner.ts` (already gone after Phase 3)
- Update `SubagentOutput` — remove `mergeConflict` / `mergeBlocked` structs;
  replace with a single `mergeConflicts?: string[]` returned from the parent's
  merge call

**⚠ Manual phase** — worktree bugs are silent and destructive. Test with a
real multi-file edit subagent task and verify changes land in the working tree.

**Exit criteria:**
- Subagent edits appear in the parent's working tree after the tool call completes
- A parallel subagent pair (two concurrent tool calls) both merge cleanly
- Merge conflict case surfaces the right file list to the LLM
- All tests pass

---

## Phase 5 — Cleanup, output, and ESC propagation

**Goal:** Remove dead code, simplify UI output, wire up interrupt.

**Changes:**

- **Output**: subagent tool call display becomes two lines only:
  - `⇢ subagent [laneId] — <prompt truncated to ~60 chars>`
  - `← subagent [laneId] done (Nin / Nout tokens)` or `✖ failed`
  - All intermediate subprocess output is suppressed (headless reporter handles this)
- **ESC interrupt**: when the user hits ESC during a turn, send `SIGTERM` to all
  tracked active subprocess PIDs before returning to the prompt; subprocesses clean
  up their worktree directory on receipt
- **Remove `execution: inline`**: delete the field from `CustomCommand`, remove
  the branch in the command handler, update `loadCustomCommands` and docs
- **Remove dead code**: `getSubagentMergeError`, `mergeConflict`/`mergeBlocked`
  fields from old `SubagentOutput`, `syncDirtyStateToWorktree` call in old runner

**Exit criteria:**
- `bun run jscpd && bun run knip && bun run typecheck && bun run format && bun run lint && bun test`
  all pass clean
- ESC during a subagent task kills the subprocess and returns to prompt without
  leaving orphan worktree directories
- No `execution: inline` references remain in source or docs
