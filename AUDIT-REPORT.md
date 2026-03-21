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

1. ~~**`supportsThinking()` + haiku = 400 error**~~ **FIXED** (`24592bc`) — Zen claude models were sent the `effort-2025-11-24` beta format (`output_config: { effort }`) which Zen's proxy crashes on (HTTP 500: `"Cannot read properties of undefined (reading input_tokens)"`). Confirmed via direct curl probes: the legacy `thinking: { type: "enabled", budget_tokens: N }` format returns HTTP 200 on Zen. Fix: detect `zen/claude-*` models in `getAnthropicThinkingOptions` and use the legacy format with mapped budgets (low=4K, medium=8K, high=16K, xhigh=32K). Note: the `effort-2025-11-24` beta format still works correctly on `api.anthropic.com`.

2. ~~**`autoTitleSession` overwrites title on every turn**~~ **NON-ISSUE** — `setSessionTitle` in the DB layer uses `AND title = ''` in the UPDATE predicate, so it only writes when the title is empty. The session title correctly stays as the first message.

3. ~~**`maxOutputTokens` hardcoded to 16384**~~ **FIXED** (`19a9755`) — Added `max_output_tokens` column to `model_capabilities` (DB v6), parsing `limit.output` from models.dev. Propagated through `ModelCapabilityRow` → `RuntimeCapability` → `ModelInfo`. `buildStreamTextRequest` now calls `getMaxOutputTokens(modelString) ?? 16384`.

4. ~~**DB lock / WAL file growth**~~ **FIXED** (`19a9755`) — Upgraded the startup checkpoint from `PASSIVE` to `TRUNCATE`, which zeroes the WAL file after applying writes. Same busy-safe wrapper; external readers still won't block startup.

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

1. ~~**Guard `supportsThinking()` more conservatively**~~ **RESOLVED** — Fixed by detecting `zen/claude-*` models and switching to the legacy `budget_tokens` API format, confirmed correct via curl probes against `opencode.ai/zen/v1`.

2. ~~**Derive `maxOutputTokens` from model info**~~ **FIXED** (`19a9755`) — See item 3 above.

3. ~~**Add a brief architecture comment at the top of `turn-execution.ts`**~~ **FIXED** (`19a9755`) — 6-line block comment added explaining `StreamToolCallTracker` and `StreamTextPhaseTracker`.

### Polish

4. **Status bar: merge model + thinking effort** (KNOWN) — The `showReasoning` field in the status bar signature contributes to unnecessary re-renders. The known issues already track this.

5. ~~**Shell tool truncation**~~ **FIXED** (`19a9755`) — Truncation now snaps to the last `\n` in the partial chunk, preventing broken mid-line cuts.

6. ~~**WAL file growth**~~ **FIXED** (`19a9755`) — See item 4 above.
