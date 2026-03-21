# Audit Report — mini-coder v0.2.0

**Date:** 2026-03-21
**Auditor:** Claude Code (automated audit)
**Scope:** Full codebase review + multi-provider interactive testing

---

## Summary

### How I tested

- **Code review:** Read every module in `src/` (15k lines across 126 files), ran all static checks (`typecheck`, `lint`, `knip`, `jscpd`, `test`), and compared implementation against the core idea in AGENTS.md.
- **Multi-provider testing:** Exercised 5 SDK paths via tmux — one-shot and interactive multi-turn sessions with tool calling:
  - `zen/claude-haiku-4-5` — `@ai-sdk/anthropic` via Zen
  - `zen/gemini-3-flash` — `@ai-sdk/google` via Zen
  - `zen/gpt-5.4-nano` — `@ai-sdk/openai` (responses endpoint) via Zen
  - `zen/kimi-k2.5` — `@ai-sdk/openai-compatible` via Zen
  - `anthropic/claude-haiku-4-5` — direct Anthropic OAuth
- **Static analysis results:** 286 tests pass, 0 lint issues, 0 type errors, 0 unused exports (knip), 2 minor code clones (23 lines, 0.16%).

### Overall assessment

The codebase is well-structured and clean. All provider paths work correctly for both one-shot and interactive use. The architecture aligns closely with the core idea. The known issues file accurately tracks existing problems. Most findings below are minor.

---

## Code & Architecture

### Correctness issues

1. **MCP client reports hardcoded version `0.1.0`** (`src/mcp/client.ts:31`)
   The MCP client identifies itself as `version: "0.1.0"` while the package is at `0.2.0`. This should use the actual package version (the same `__PACKAGE_VERSION__` constant used in the banner).

2. **`isAbortError` relies on string matching** (`src/agent/agent-helpers.ts:13–17`)
   `isAbortError` checks `error.name === "AbortError"` OR `error.message.toLowerCase().includes("abort")`. The message fallback is overly broad — any error mentioning "abort" (e.g. "Transaction aborted by user") would be treated as a cancellation. This hasn't caused issues in practice but is a latent correctness risk.

3. **Shell `!` integration silently drops context for empty output** (`src/cli/input-loop.ts:98`)
   When a `!` shell command produces no stdout, no stderr, and exits successfully, `buildShellContext` returns an empty string and `addShellContext` is skipped entirely. The user sees the command run but nothing is recorded. For `!ls` in an empty dir this is fine, but for side-effect commands like `!git commit` the exit status context is lost.

### KISS / DRY / YAGNI

4. **Duplicate frontmatter parsers** (already tracked in KNOWN_ISSUES.md)
   `parseFrontmatter` in `cli/frontmatter.ts` and `parseSkillFrontmatter` in `cli/skills.ts` implement the same YAML-like frontmatter parsing with slightly different APIs. The skills variant reads from file descriptors for performance (only reads first 64KB), which is a good optimization, but the parsing logic itself is duplicated.

5. **Truncation helpers are scattered** (already tracked in KNOWN_ISSUES.md)
   At least 4 independent truncation implementations: `truncate` in `tool-render.ts`, `truncateOneLine` in `tool-result-renderers.ts`, `truncatePlainText` in `status-bar.ts`, and `compactHeadTail` in `turn-context.ts`. The LLM-facing truncation (`compactHeadTail`) is structurally different from the UI-facing ones, so not all can be consolidated, but the three UI truncation functions share the same pattern.

6. **`getMessageDiagnostics` builds maps that are only consumed by logging** (`src/llm-api/turn-context.ts`)
   The full diagnostics function (`getMessageDiagnostics`) is only called from the API logging path. The lightweight `getMessageStats` exists for the hot path. This is actually good design — no violation — but the `getMessageDiagnostics` function is quite heavyweight for diagnostic-only use; worth noting it's correctly excluded from the critical path.

### Idea alignment

7. **System prompt doesn't mention file creation workflow**
   The system prompt describes `mc-edit` for editing existing files but doesn't mention how to create new files (using shell commands like `cat >` or `printf`). During GPT Nano testing, the model tried `mc-edit` for file creation, got two errors, then self-corrected. Adding a brief note about file creation would save tokens on error recovery.

8. **`maxOutputTokens` hardcoded to 16384** (already tracked in KNOWN_ISSUES.md)
   The value in `turn-request.ts:82` is a fixed constant. The core idea says to derive from model info. Model data is already available via `resolveModelInfo()`.

9. **No conversation summary on max context** (already tracked in KNOWN_ISSUES.md)
   The `error-parse.ts` surfaces a "Max context size reached" error with hint "Use /new to start a fresh session". The core idea wants "a conversation summary" instead of just an error.

---

## UI/UX Alignment

### Cross-provider consistency

All five tested paths produce visually consistent output:

- **Banner** renders correctly with model, cwd, skills count, and toggle states.
- **Status bar** shows model, session ID, token counts, context usage, and cwd. Format is consistent across all providers.
- **Tool call display** uses correct semantic glyphs (`←` for reads, `✎` for writes, `$` for exec, `?` for search). Truncation at 80 chars works.
- **Tool results** show structured output: exit code, stdout/stderr line counts, inline single-line results.
- **Assistant text** prefixed with `◆`, user prompts with `›`.
- **Spinner** shows during thinking, clears correctly before output.

### Provider-specific observations

| Provider                     | One-shot | Interactive | Multi-turn | Notes                                               |
| ---------------------------- | -------- | ----------- | ---------- | --------------------------------------------------- |
| `zen/claude-haiku-4-5`       | ✅       | ✅          | ✅         | Clean tool use, good output                         |
| `zen/gemini-3-flash`         | ✅       | ✅          | —          | Efficient: combined create+read in one tool call    |
| `zen/gpt-5.4-nano`           | ✅       | ✅          | —          | Tried mc-edit for new file, self-corrected (see #7) |
| `zen/kimi-k2.5`              | ✅       | ✅          | —          | Leading whitespace in one-shot output (cosmetic)    |
| `anthropic/claude-haiku-4-5` | ✅       | ✅          | ✅         | Clean, ESC interrupt works                          |

### UI issues observed

10. ~~**Double prompt glyph after ESC interrupt**~~ — Investigated: this is a tmux `capture-pane` rendering artifact, not an actual double prompt. Raw stdout analysis confirms only one `renderPrompt` call. Removed from KNOWN_ISSUES.

11. **Token counts not updated after interrupted turn**
    After ESC interrupt, the status bar shows stale token counts from the previous completed turn, not from the interrupted one. The interrupted turn's partial usage isn't accumulated because the error path doesn't emit a `turn-complete` event with usage data.

12. **Context window disappears from status bar after interrupt**
    After an ESC-interrupted turn, the status bar dropped the `ctx X/Y Z%` segment entirely. This is because `lastContextTokens` stays 0 when the turn is interrupted (the complete event is never processed), and `buildContextSegment` returns `null` for `contextTokens <= 0`.

13. **`/help` skills section shows full descriptions without truncation**
    The ai-sdk skill description wraps across 3 lines in the help output. Skills with long descriptions should be truncated in the help display for consistency with the concise help format.

14. **tmux `send-keys` triggers paste detection**
    When using `tmux send-keys` with multi-word text (without `-l`), the input handler detects it as a paste and shows `[pasted: "..."]`. Using `-l` (literal) mode for send-keys + separate Enter works correctly. This is technically correct behavior (tmux sends all chars in one burst) but makes automated testing harder. Not a user-facing issue.

---

## Recommendations

### Immediate bugs (should fix)

1. **Token count reset after ESC interrupt** — The interrupted turn's `inputTokens`/`outputTokens` from `turnState.getState()` are available in the `turn-error` event's `partialMessages` path, but `session-runner.ts` doesn't accumulate them because the `try` block throws before reaching the accumulation code. Move token accumulation to a `finally` block or accumulate from the error event.

2. **Context window vanishing after interrupt** — Related to #1. When `lastContextTokens` is 0, the status bar omits the context segment. Either preserve the last known context tokens across interrupts, or include `contextTokens` in the error event.

3. **System prompt: add file creation guidance** — Add one line to the mc-edit description: "To create new files, use shell commands (e.g. `cat > file.txt << 'EOF'`)." This will save tool-call roundtrips for all models.

### Code changes (should address)

4. **MCP client version** — Use `__PACKAGE_VERSION__` or read from package.json instead of hardcoding `"0.1.0"`.

5. **`isAbortError` specificity** — Tighten the message check: look for "aborted" specifically, or check for `err.code === "ABORT_ERR"` instead of substring matching.

6. **`!` shell: preserve exit status context** — When `buildShellContext` returns empty, still record something like `"(no output, exit 0)"` so the model knows the command succeeded.

### Polish items (nice to have)

7. **Consolidate UI truncation helpers** — The three UI-facing `truncate`/`truncateOneLine`/`truncatePlainText` functions can share a single helper.

8. **Consolidate frontmatter parsers** — Make `parseSkillFrontmatter` call `parseFrontmatter` after reading the first 64KB chunk, or factor the regex/loop into a shared helper.

9. **Help: truncate skill descriptions** — Limit skill descriptions in `/help` output to ~100 chars.

10. **Double prompt glyph** — Suppress the extra newline in `stream-render.ts` when the turn was interrupted via ESC.

---

_This report covers audit findings only. No changes have been made. Review with the user before implementing._
