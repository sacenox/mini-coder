# Code Health Remediation Plan

## Goal
Address maintainability and reliability issues identified in `code-health.md` with low-risk, incremental refactors that keep behavior stable.

## Constraints
- Keep `mini-coder-idea.md` and `README.md` unchanged.
- Prefer small PR-sized changes with passing tests after each step.
- Preserve current CLI behavior while improving structure.

## Workstreams

### 1) Decompose `src/agent/agent.ts` (High)
**Outcome:** `runAgent` remains orchestration entrypoint; responsibilities split into focused modules.

**Steps:**
1. Add `src/agent/reporter.ts` interface (narrow surface for output/status/tool events).
2. Extract session lifecycle + turn loop into `src/agent/session-runner.ts`.
3. Extract subagent execution into `src/agent/subagent-runner.ts`.
4. Extract snapshot/undo helpers into `src/agent/undo-snapshot.ts`.
5. Extract user input processing into `src/agent/input-loop.ts`.
6. Keep `agent.ts` as composition/wiring file only.

**Checks:**
- Add/adjust unit tests around orchestration boundaries.
- Ensure no behavior regressions in interrupts, resume, and tool-call flows.

---

### 2) Decompose `src/cli/output.ts` (High)
**Outcome:** Rendering responsibilities isolated and testable.

**Target modules:**
- `src/cli/spinner.ts`
- `src/cli/tool-render.ts`
- `src/cli/stream-render.ts`
- `src/cli/status-bar.ts`
- `src/cli/error-render.ts`
- `src/cli/output.ts` as facade

**Steps:**
1. Extract pure formatting helpers first (no IO).
2. Extract spinner lifecycle module.
3. Extract stream queue/tick/flush behavior.
4. Keep compatibility exports in `output.ts` to avoid broad callsite churn.

**Checks:**
- Add focused tests for formatting + stream behavior.
- Verify terminal rendering remains stable manually.

---

### 3) Introduce `TerminalIO` abstraction (Medium)
**Outcome:** Centralized process/TTY interactions and signal lifecycle.

**Steps:**
1. Create `src/cli/terminal-io.ts` with methods for stdout/stderr writes, raw mode, signal subscriptions.
2. Replace direct `process.*` use in output/input stack with injected `TerminalIO`.
3. Centralize signal registration/unregistration in one lifecycle owner.

**Checks:**
- Add unit tests for signal registration cleanup semantics.
- Confirm no stuck raw-mode edge cases.

---

### 4) Split DB layer by domain (Medium)
**Outcome:** Reduced blast radius and clearer data ownership.

**Target modules:**
- `src/session/db/connection.ts`
- `src/session/db/session-repo.ts`
- `src/session/db/message-repo.ts`
- `src/session/db/settings-repo.ts`
- `src/session/db/mcp-repo.ts`
- `src/session/db/snapshot-repo.ts`
- `src/session/db/index.ts` (facade exports)

**Steps:**
1. Move code without behavior changes.
2. Keep SQL and schema unchanged initially.
3. Replace direct `JSON.parse` in message loading with guarded parser:
   - skip malformed rows
   - emit diagnostic via logger/reporter

**Checks:**
- Add tests for malformed payload handling.
- Validate existing DB tests still pass.

---

### 5) Shared markdown config loader (Medium)
**Outcome:** Remove duplication across agents/skills/custom-commands.

**Steps:**
1. Create `src/cli/load-markdown-configs.ts` with parameterized layout strategy.
2. Migrate:
   - `src/cli/agents.ts`
   - `src/cli/skills.ts`
   - `src/cli/custom-commands.ts`
3. Keep precedence rules identical (built-in/user/project).
4. Preserve existing frontmatter semantics.

**Checks:**
- Reuse/expand existing loader tests to cover parity.

---

### 6) Runtime/UI decoupling via reporter boundary (Medium)
**Outcome:** Core runtime no longer depends directly on terminal rendering.

**Steps:**
1. Define domain events or reporter interface in `src/agent/reporter.ts`.
2. Implement CLI reporter adapter in `src/cli/output-reporter.ts`.
3. Replace direct output calls in agent runtime with reporter calls.

**Checks:**
- Add tests using test reporter to assert emitted events.

---

### 7) Error observability and silent catches (Medium)
**Outcome:** Non-fatal failures become diagnosable without crashing.

**Steps:**
1. Find empty/broad catches in agent/output/loaders.
2. Add debug-level diagnostics with contextual metadata.
3. Keep user-facing behavior unchanged unless critical.

**Checks:**
- Validate noisy paths are still quiet at normal verbosity.

---

### 8) Startup FS sync usage (Low/Deferred)
**Outcome:** Optional responsiveness improvement if startup cost grows.

**Steps:**
1. Measure startup and config-loading time first.
2. If needed, move high-volume file scanning to async or cache results with invalidation.

---

### 9) Test hygiene cleanup (Low)
**Outcome:** Cleaner CI output.

**Steps:**
1. Remove `console.log` skip notices in `src/tools/shell.test.ts`.
2. Use test-framework-native skip annotations/helpers.

---

## Execution Order (recommended)
1. Reporter interface (foundation for later decoupling).
2. `agent.ts` decomposition.
3. `output.ts` decomposition.
4. Shared config loader extraction.
5. DB module split + safe JSON parsing.
6. TerminalIO + centralized signals.
7. Silent catch diagnostics.
8. Test hygiene and any deferred FS optimization.

## Definition of Done
- `bun run typecheck && bun run format && bun run lint && bun test` passes.
- No behavior regressions in interactive CLI flows.
- `agent.ts` and `output.ts` materially reduced in size/responsibility.
- Config loader duplication removed.
- Message loading resilient to malformed JSON rows.
- New abstractions documented in code comments where non-obvious.
