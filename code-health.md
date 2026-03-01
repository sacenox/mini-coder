# Code Health Analysis

## Scope
Reviewed the TypeScript codebase in `src/` for code smells: duplication, tight coupling, oversized modules, unsafe patterns, and maintainability risks.

---

## Findings

### 1) God module / high complexity: `src/agent/agent.ts`
- **Smell:** Single file with very broad responsibilities (session lifecycle, CLI interaction, subagent orchestration, MCP wiring, snapshot/undo flow, model turn handling).
- **Evidence:** ~775 lines and many nested functions (`runSubagent`, `processUserInput`, `renderStatusBarForSession`, etc.).
- **Impact:** Harder to reason about, test, and safely change; increases risk of regressions.
- **Recommendation:** Split into focused modules (e.g. `session-runner`, `subagent-runner`, `undo-snapshot`, `input-loop`, `mcp-runtime`). Keep `runAgent` as composition entrypoint.

### 2) God module / rendering mixed with stateful stream logic: `src/cli/output.ts`
- **Smell:** UI primitives, spinner, glyph vocabulary, tool-call formatting, subagent stream rendering, diff rendering, status bar, error rendering all in one file.
- **Evidence:** ~935 lines, many responsibilities and nested queue/tick/flush behavior.
- **Impact:** High cognitive load and brittle changes; difficult targeted unit testing.
- **Recommendation:** Extract: `spinner.ts`, `tool-render.ts`, `stream-render.ts`, `status-bar.ts`, `error-render.ts`, and keep `output.ts` as facade.

### 3) Tight coupling to global process state in CLI/output stack
- **Smell:** Direct writes and signal handling scattered in rendering/terminal functions.
- **Evidence:** `process.stdout.write`, `process.stderr.write`, `process.on("SIGINT"|"SIGTERM"|...)`, raw mode toggling in `src/cli/output.ts`.
- **Impact:** Hard to test deterministically, side effects leak across features, higher chance of terminal-state bugs.
- **Recommendation:** Introduce a thin `TerminalIO` abstraction injected where needed; centralize signal registration in one lifecycle module.

### 4) Destructive DB migration strategy in `src/session/db.ts`
- Intentional, not an issue.

### 5) Database layer combines many bounded contexts
- **Smell:** One module owns sessions, messages, prompt history, MCP server registry, settings, snapshots.
- **Evidence:** `src/session/db.ts` exposes many unrelated CRUD APIs in one file.
- **Impact:** Hidden coupling and broad blast radius for edits; hard to isolate tests and optimize specific query domains.
- **Recommendation:** Split repository-style modules by domain (`session-repo`, `message-repo`, `settings-repo`, `mcp-repo`, `snapshot-repo`) sharing one DB connection provider.

### 6) Clear duplication across config loaders
- **Smell:** Repeated directory scanning/parsing/merge logic in:
  - `src/cli/agents.ts`
  - `src/cli/skills.ts`
  - `src/cli/custom-commands.ts`
- **Evidence:** Similar `loadFromDir` patterns (exists/readdir/read/parse/frontmatter/defaults/merge precedence).
- **Impact:** Bug fixes and behavior changes must be repeated; inconsistency risk.
- **Recommendation:** Create shared loader utility (`loadMarkdownConfigs`) parameterized by layout (`.md file` vs `folder/SKILL.md`), metadata mapping, and precedence rules.

### 7) Business logic mixed with presentation concerns
- **Smell:** Runtime operations call rendering directly (e.g., tool events, hooks, info/error) instead of emitting structured events.
- **Evidence:** `agent.ts` imports many render methods from `cli/output.ts` and calls them inline through control flow.
- **Impact:** Strong coupling between core runtime and terminal UI; limits reuse (non-TTY / API mode), harder unit tests.
- **Recommendation:** Move to event-driven boundary (domain events -> renderer subscriber), or inject a narrow reporter interface.

### 8) Broad `catch {}` swallowing and silent fallbacks
- **Smell:** Multiple places ignore errors with empty catches or comments.
- **Evidence:** e.g., context file loading in `agent.ts`, cleanup paths in `output.ts`, loader paths in config modules.
- **Impact:** Operational issues become invisible; debugging production edge cases is harder.
- **Recommendation:** Keep non-fatal behavior but log at debug/trace level (or structured diagnostics) with enough context.

### 9) Unsafe JSON parsing without recovery path in message loading
- **Smell:** `loadMessages` does `JSON.parse(row.payload)` directly.
- **Evidence:** `src/session/db.ts` maps rows with direct parse cast to `CoreMessage`.
- **Impact:** Single corrupted row can break session load path.
- **Recommendation:** Add guarded parsing with skip/report strategy and optional integrity repair command.

### 10) Sync filesystem use in hot-path-ish configuration loading
- **Smell:** `existsSync`, `readFileSync`, `readdirSync`, `statSync` widely used in CLI startup/runtime flows.
- **Evidence:** `agents.ts`, `skills.ts`, `custom-commands.ts`, and context file loading.
- **Impact:** Blocks event loop; usually acceptable at startup but can degrade responsiveness in larger repos/config sets.
- **Recommendation:** If responsiveness becomes an issue, move to async FS or memoized cache with invalidation.

### 11) Minor test smell: console output in tests
- **Smell:** `console.log` in `src/tools/shell.test.ts` for skip notices.
- **Impact:** Noisy CI output; not harmful but less clean.
- **Recommendation:** Prefer test framework skip metadata or helper wrappers for conditional skips.

---

## Priority Recommendations
1. **High:** Decompose `agent.ts` and `output.ts` (largest maintainability win).
2. **High:** Replace destructive DB version reset with real migrations.
3. **Medium:** Introduce shared config-loader abstraction to remove duplication.
4. **Medium:** Decouple runtime from renderer via event/reporter interface.
5. **Medium:** Improve error observability (avoid silent catches).

---

## Positive Notes
- Strong typing overall; very little `any` / ts-ignore usage observed.
- Clear module naming and pragmatic structure in many utility files.
- Presence of focused unit tests across core tools (`replace`, `insert`, `snapshot`, etc.).
