# Audit Report — mini-coder v0.2.0

**Date:** 2026-03-20
**Auditor:** Claude Code (automated audit)

---

## Summary

### How I tested

1. **Code review**: Read every module (15,116 lines across ~80 source files). Verified tests (290 pass), lint, types, formatting, knip, and jscpd all pass clean.
2. **One-shot tests** across 5 SDK paths: `zen/claude-haiku-4-5`, `zen/gemini-3-flash`, `zen/gpt-5.4-nano`, `zen/minimax-m2.5`, and `anthropic/claude-haiku-4-5` (OAuth). Exercised simple prompts and tool-calling (shell reads).
3. **Interactive tmux sessions**: Multi-turn conversations with model switching, `/help`, `/undo`, `/new`, `!shell`, `/model`, skill listing — tested across all 5 provider paths in the same session.

### Overall

The codebase is **well-architected, cleanly separated, and functional across all tested providers**. The core idea is faithfully implemented. The handful of issues found are mostly minor refinements and one moderate architectural concern.

---

## Code & Architecture

### Correctness issues

1. **MCP client version hardcoded to `0.1.0`** (`src/mcp/client.ts:30`). Package is at `0.2.0`. Should derive from `__PACKAGE_VERSION__` or at least stay in sync.

2. **Context pruning fires spuriously on clean conversations** — Anthropic OAuth path showed `context pruned –0 messages –0.4 KB` on a short conversation. The pruned event fires because `postPruneTotalBytes < prePruneTotalBytes` even though no messages were removed — the byte delta comes from provider-option stripping in sanitisation, not actual pruning. This is cosmetically confusing but functionally harmless. The `pruned` flag in `prepareTurnMessages` should compare message counts only, or use a meaningful byte threshold.

3. **Error log writes are not append-mode** — `logError()` in `error-log.ts` does `writer.write(…)` but each call overwrites context since there's no separator between entries. Two rapid errors will concatenate without a newline boundary between them. The api-log correctly uses `---\n` separators; error-log should do the same.

### KISS/DRY/YAGNI

4. **Three near-identical `truncate` functions** — `truncate()` in `tool-render.ts`, `truncateOneLine()` in `tool-result-renderers.ts`, and `truncatePlainText()` in `status-bar.ts` all implement `s.length > max ? s.slice(0, max-1) + "…" : s`. This is tracked in KNOWN_ISSUES as "consolidate truncation helpers" but worth emphasizing as it's the lowest-hanging DRY violation.

5. **Dual frontmatter parsers** — `parseSkillFrontmatter` (skills.ts, line-by-line from fd) and `parseFrontmatter` (frontmatter.ts, regex-based from string) both parse the same `---\nkey: value\n---` format with identical key-value extraction logic. Also tracked in KNOWN_ISSUES. The skills parser is more efficient (reads only the first 2KB) — consolidation should keep that optimization.

6. **`isOpenAIReasoningModelFamily` is overly broad** — `modelId.startsWith("gpt-5")` classifies all GPT-5.x models (including nano) as reasoning-capable. This is currently gated by `supportsThinking()` from models.dev data, so no runtime bug, but it means thinking provider options would be attempted on nano models if models.dev data is stale or missing. The function name implies it checks for reasoning capability, but it's really checking for the responses API endpoint family.

### Alignment with core idea

7. **"Conversation summary on max context"** — The core idea states "Stops with a conversation summary if max context is reached." Currently tracked in KNOWN_ISSUES as a feature gap. The current behavior is an error + suggestion to `/new`. This is the biggest feature gap vs. the specification.

8. **`maxOutputTokens` hardcoded at 16384** (`turn-request.ts:71`) — The core idea says "Derive maxOutputTokens from model info." Tracked in KNOWN_ISSUES. Some models (e.g. Gemini 3 Flash, GPT-5.4) support much higher output limits.

---

## UI/UX Alignment

### Across all providers

| Aspect                   | Expected (core idea)                        | Actual                                                           | Verdict |
| ------------------------ | ------------------------------------------- | ---------------------------------------------------------------- | ------- |
| Banner at start          | Model, cwd, found configs, skills           | ✓ Shows all: model, cwd, AGENTS.md, skill count                  | ✅      |
| Status bar               | Model, session, git branch, tokens, context | ✓ All present, context % colored at thresholds                   | ✅      |
| Spinner during wait      | Colored animation with labels               | ✓ Braille spinner on stderr with tool/thinking labels            | ✅      |
| Shell tool rendering     | Command + output                            | ✓ Smart glyphs (read/write/search), exit code, head/tail preview | ✅      |
| Skill tool rendering     | Compact metadata                            | ✓ Name, source, description — compact and readable               | ✅      |
| `/help`                  | Commands overview                           | ✓ Comprehensive, grouped, includes skills                        | ✅      |
| `/undo`                  | Remove last turn                            | ✓ Works correctly, removes from DB + memory                      | ✅      |
| `/new`                   | Fresh session, clean display                | ✓ Clears screen, reprints banner                                 | ✅      |
| `/model`                 | Switch with autocomplete                    | ✓ Switches, persists, updates status bar                         | ✅      |
| `!cmd` shell integration | Run + keep in context                       | ✓ Renders output, adds to history                                | ✅      |
| ESC to interrupt         | Partial response preserved                  | Verified in code — uses AbortController + stub append            | ✅      |
| 16 ANSI colors only      | Inherits terminal theme                     | ✓ Uses yoctocolors, all glyphs from 16-color palette             | ✅      |

### Provider-specific findings

| Provider                             | One-shot | Interactive | Tool calling | Notes                                                                                                             |
| ------------------------------------ | -------- | ----------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `zen/claude-haiku-4-5`               | ✅       | ✅          | ✅           | Clean, fast                                                                                                       |
| `zen/gemini-3-flash`                 | ✅       | ✅          | ✅           | Clean, fast                                                                                                       |
| `zen/gpt-5.4-nano`                   | ✅       | ✅          | ✅           | Clean. Correctly uses responses endpoint                                                                          |
| `zen/minimax-m2.5`                   | ✅       | ✅          | ✅           | **Blank lines in one-shot output** (known issue). Interactive mode looks fine. Reasoning blocks render correctly. |
| `anthropic/claude-haiku-4-5` (OAuth) | ✅       | ✅          | ✅           | OAuth identity injection works. Spurious pruning event (item 2 above).                                            |

### UI observations

- **Paste detection in tmux**: When `tmux send-keys` sends text rapidly, bracketed paste mode activates and shows `[pasted: "..."]` label instead of the typed text. This is correct behavior — it's how the terminal reports pasted input. Using `-l` flag for literal keys avoids this. Real users typing normally won't see this.
- **Output hierarchy**: The `›` (user) → `$` (shell) / `?` (search) / `←` (read) / `✎` (write) → `◆` (assistant) visual hierarchy is clear and consistent across all providers.
- **Token tracking**: Cumulative `tok in/out` and `ctx` with percentage are accurate and update correctly after each turn and model switch.

---

## Recommendations

### Immediate bugs

1. **Fix spurious "context pruned" event on Anthropic OAuth** — Compare only message counts (not bytes) when determining if pruning occurred, or set a minimum byte threshold (e.g. 1KB) to suppress noise.
2. **Error log entry separation** — Add `\n---\n` separators in `logError()` to match api-log format.
3. **MCP client version** — Use `__PACKAGE_VERSION__` or synchronize with package.json.

### Code changes

4. **Consolidate truncation helpers** — Create `src/cli/truncate.ts` with a single `truncate(s, max)` function. (KNOWN_ISSUES item)
5. **Consolidate frontmatter parsers** — Unify `parseSkillFrontmatter` and `parseFrontmatter` into one module that supports both string and fd-based input. (KNOWN_ISSUES item)
6. **Derive `maxOutputTokens` from model info** — Use `resolveModelInfo()` to get model-specific limits. Fall back to 16384. (KNOWN_ISSUES item)

### Polish items

7. **Conversation summary on max context** — The most impactful feature gap. When context is exhausted, produce a summary of the conversation so far before starting fresh. (KNOWN_ISSUES item)
8. **MiniMax blank lines in one-shot** — The empty text deltas from MiniMax produce visible blank lines before the response. Stripping leading whitespace from the final one-shot output, or filtering empty text-delta events, would fix this.
9. **Status bar: `showReasoning`** — The status bar signature includes `showReasoning` but it's not rendered in the status line (only in the banner). Either add it to the status bar or remove it from the signature to avoid unnecessary re-renders. (Partially tracked in KNOWN_ISSUES as "drop showReasoning from status bar")
