# Audit Report — mini-coder v0.2.0

**Date:** 2026-03-21
**Auditor:** Automated audit via mini-coder audit skill
**Scope:** Full code review + multi-provider interactive/one-shot testing

---

## Summary

Reviewed all ~15K lines of TypeScript across 90 source files. Ran `bun run check` (303 tests pass, 0 lint/type/formatting issues). Tested 5 provider paths (zen/claude-haiku-4-5, zen/gemini-3-flash, zen/gpt-5.4-nano, zen/glm-5, anthropic/claude-haiku-4-5 via OAuth) in both one-shot and interactive tmux sessions. Exercised multi-turn tool use, model switching, ESC interrupt, `/new`, `/undo`, `/help`, `!` shell integration, and `listSkills`.

**Overall assessment:** The codebase is well-structured, adheres closely to the core idea, and works correctly across all provider paths. The architecture is clean with good separation of concerns. The issues found are minor.

---

## Code & Architecture

### Correctness Issues

1. **`supportsThinking()` + haiku = 400 error** (KNOWN) — When `preferred_thinking_effort` is set in the DB, all models get thinking options sent, including haiku models that reject adaptive thinking. The user hits a 400 on first use with a stored thinking preference. Root cause: `supportsThinking()` trusts models.dev `reasoning` flag, which is `true` for haiku models even though Zen's haiku endpoint rejects the `thinking` parameter.

2. **`autoTitleSession` overwrites title on every turn** — `setSessionTitle` is called on every `processUserInput`, not just the first. Looking at the DB layer, it likely uses `INSERT OR REPLACE` or always updates. This means the session title changes to match the latest user message instead of staying as the first message. Should check if already titled.

3. **`maxOutputTokens` hardcoded to 16384** (KNOWN) — In `turn-request.ts` line `maxOutputTokens: 16384`. The model-info cache already has context window data; deriving max output from model info would be more accurate, especially for models with larger output limits.

4. **DB lock during concurrent access** — The settings restore command failed with `database is locked` because the WAL wasn't fully checkpointed. The `busy_timeout=1000` is set, but external sqlite3 CLI access can still conflict. Not a bug per se, but the WAL file grows large (4MB observed).

### Architecture Alignment with Core Idea

- ✅ **Append-only scrolling log** — No redraws, strict hierarchy works correctly.
- ✅ **Shell-first tool surface** — `shell`, `listSkills`, `readSkill`, MCP, and optional web tools. Minimal and correct.
- ✅ **`mc-edit` exact-text edits** — Deterministic, well-tested (94 tests).
- ✅ **16 ANSI colors only** — Uses yoctocolors consistently, inherits terminal theme.
- ✅ **Status bar** — Shows model, session ID, git branch, thinking effort, token counts, context %.
- ✅ **Context pruning** — Rolling per-step pruning with Anthropic cache preservation. Well-designed.
- ✅ **Single system prompt** — No provider-specific branches. Works across all providers.
- ✅ **Community config standards** — AGENTS.md discovery, skills from `.agents/skills/` and `.claude/skills/`.
- ✅ **Session management** — SQLite-backed, with resume, list, new session.
- ✅ **MCP support** — StreamableHTTP with SSE fallback, stdio transport.
- ✅ **OAuth login** — Anthropic OAuth with PKCE flow.
- ✅ **ESC interrupt** — Works cleanly, preserves partial response in history.

### KISS / DRY / YAGNI

- **Good**: The codebase is lean. No unnecessary abstractions. Provider routing is simple prefix-based dispatch.
- **Good**: jscpd reports only 0.16% duplication (23 lines across 129 files).
- **Minor**: `turn-execution.ts` has substantial complexity in `StreamToolCallTracker` and `StreamTextPhaseTracker` for handling provider quirks (OpenAI commentary phases, synthetic tool call IDs). This is justified given the real provider differences, but the file is dense at ~300+ lines. Could benefit from a short doc comment explaining the overall stream normalization strategy.
- **Minor**: `cli/` module has 43 files — the largest module. Most are appropriately scoped, but the input handling is spread across 6 files (`input.ts`, `input-buffer.ts`, `input-completion.ts`, `input-control.ts`, `input-editing.ts`, `input-images.ts`, `input-loop.ts`). This is understandable for complexity management but makes the input pipeline harder to trace.

### Things NOT in Known Issues Worth Noting

- **No conversation summary on max context** — The pruning approach (`pruneMessages` from AI SDK) silently removes messages. When context is exhausted, the user gets a generic error. The known issues already track this.
- **`onError: () => {}`** in `turn-request.ts` — Correctly suppresses SDK's default `console.error()`. Errors still propagate through `fullStream` as `{ type: "error" }` chunks, which `mapStreamChunkToTurnEvent` handles by throwing. Not related to hangs.

---

## UI/UX Alignment

### Provider Comparison

| Feature                | zen/claude-haiku-4-5 | zen/gemini-3-flash | zen/gpt-5.4-nano | zen/glm-5 | anthropic/claude-haiku-4-5 (OAuth) |
| ---------------------- | -------------------- | ------------------ | ---------------- | --------- | ---------------------------------- |
| One-shot simple        | ✅                   | ✅                 | ✅               | ✅        | ✅                                 |
| One-shot with tools    | ✅                   | ✅                 | ✅               | N/T       | N/T                                |
| Interactive multi-turn | ✅                   | ✅                 | ✅               | ✅        | ✅                                 |
| Tool calls displayed   | Clean                | Clean              | Clean            | Clean     | Clean                              |
| Token tracking         | Accurate             | Accurate           | Accurate         | Accurate  | Accurate                           |
| Context %              | 3%                   | 0-1%               | 1%               | 3%        | 5%                                 |
| ESC interrupt          | ✅                   | ✅                 | N/T              | N/T       | N/T                                |
| Model switching        | ✅                   | ✅                 | ✅               | ✅        | ✅                                 |

N/T = Not specifically tested in interactive mode, but one-shot works.

### UI Observations

- **Banner**: Clean, shows version, model, cwd, AGENTS.md, skill count. Matches spec.
- **Status bar**: Updates correctly after each turn. Token counts accumulate properly. Context window percentage is color-coded (green/yellow/red). Model and session ID always visible.
- **Tool rendering**: Shell commands show the command, exit code, and line count. Output is properly boxed with `│` prefix. Short outputs show inline (`out: hello world`). Long outputs get line-counted display.
- **`/help` output**: Lists all commands and all 20 skills with descriptions and source (global/local). Includes keyboard shortcuts.
- **Spinner**: Shows during thinking/tool execution. Clears cleanly on interrupt.
- **`/new`**: Clears screen and reprints banner — feels like a fresh start.

### One Surprising Behavior

- **`!` shell output stays local** — The `!echo "test"` shell integration runs the command and adds the output to history for the LLM, but doesn't trigger a model response. This is by design (spec says "sends the output to the llm as user message") but users might expect the LLM to comment on it. The current behavior is arguably better — it's like pasting context.

---

## Recommendations

### Code Changes

1. **Guard `supportsThinking()` more conservatively** — The models.dev `reasoning: true` flag is too broad. Either maintain a local allowlist of models that accept adaptive thinking, or catch the 400 and retry without thinking options. This is the most impactful known issue — it breaks the first-run experience when a thinking preference is stored.

2. **Derive `maxOutputTokens` from model info** — The model-info cache already stores capabilities. Use it instead of the 16384 hardcode.

3. **Add a brief architecture comment at the top of `turn-execution.ts`** — The stream normalization logic is the most complex part of the codebase. A 5-line comment explaining why synthetic tool call IDs and phase tracking exist would help future contributors.

### Polish

4. **Status bar: merge model + thinking effort** (KNOWN) — The `showReasoning` field in the status bar signature contributes to unnecessary re-renders. The known issues already track this.

5. **Shell tool truncation** — The `MAX_OUTPUT_BYTES = 10_000` truncation cuts mid-stream. The known issue about truncating at argument boundaries applies here too — truncated outputs can lose important trailing context.

6. **WAL file growth** — The sessions.db WAL file was 4MB. The `PASSIVE` checkpoint at startup may not always succeed. Consider a more aggressive checkpoint strategy or periodic forced checkpoints.
