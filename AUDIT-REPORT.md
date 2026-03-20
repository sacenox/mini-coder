# Audit Report — mini-coder v0.2.0

**Date:** 2026-03-20  
**Auditor:** Claude (via audit skill)  
**Commit:** HEAD on `main`

---

## Summary

**Phase 1** reviewed all core source files (~15k LoC across 80+ modules) against `mini-coder-idea.md`. All checks pass: 290 tests, 0 lint errors, 0 type errors, 0 knip issues, 0.16% code duplication.

**Phase 2** tested 5 provider paths interactively via tmux and one-shot pipes:

| Provider path           | Model                        | SDK package                 | Result                      |
| ----------------------- | ---------------------------- | --------------------------- | --------------------------- |
| Anthropic (Zen)         | `zen/claude-haiku-4-5`       | `@ai-sdk/anthropic`         | ✅ Works (without thinking) |
| Google (Zen)            | `zen/gemini-3-flash`         | `@ai-sdk/google`            | ✅ Works                    |
| OpenAI responses (Zen)  | `zen/gpt-5.4-nano`           | `@ai-sdk/openai`            | ✅ Works                    |
| OpenAI-compatible (Zen) | `zen/minimax-m2.5`           | `@ai-sdk/openai-compatible` | ✅ Works                    |
| Anthropic OAuth         | `anthropic/claude-haiku-4-5` | `@ai-sdk/anthropic`         | ✅ Works                    |

Each was tested with multi-step, multi-turn prompts exercising tool calls, shell output rendering, and follow-up questions. One-shot mode was verified with piped stdin for Haiku and Gemini.

---

## Code & Architecture

### ✅ Strengths

- **Clean separation of concerns**: `agent/`, `cli/`, `llm-api/`, `session/`, `tools/`, `internal/` modules are well-scoped. Files are small and focused.
- **System prompt is well-structured**: AGENTS.md/CLAUDE.md discovery, skill metadata injection, and behavioural sections are cleanly composed.
- **Provider routing is elegant**: `model-routing.ts` and `providers.ts` cleanly map `<provider>/<model-id>` strings to the right SDK factory with lazy initialization.
- **Context management**: Step-aware pruning in `turn-context.ts` is sophisticated — correctly anchors the Anthropic cache prefix and handles the step-0 vs step-1+ distinction.
- **Tool rendering**: Shell output is well-presented with contextual glyphs, head/tail truncation, and colored badges. The parallel tool call `↳` markers work correctly.
- **Test coverage**: 290 tests covering the important logic (exact-text edits, model routing, stream events, context pruning, etc.) without mocking dependencies.

### 🐛 Bugs Found

1. **Thinking effort breaks `claude-haiku-4-5` via Zen** — The model info cache (sourced from models.dev) marks `claude-haiku-4-5` as `reasoning: 1`. When a thinking effort is persisted (e.g. `medium`), the app sends `"thinking": {"type": "adaptive"}` which Zen (and likely the Anthropic API) rejects with a 400: _"adaptive thinking is not supported on this model"_. The `supportsThinking()` check is too broad — it trusts the models.dev flag but doesn't validate whether the specific model actually accepts the adaptive thinking API parameter. Without a persisted thinking effort the model works fine.

2. **`zen/claude-3-5-haiku` 404** — The AI SDK auto-resolves `claude-3-5-haiku` to `claude-3-5-haiku-20241022`, which Zen doesn't serve. The Zen endpoint expects exactly `claude-3-5-haiku`. This is an SDK behaviour issue that may need a workaround or documentation.

### ⚠️ Issues & Observations

3. **Banner vs system prompt context file divergence** — `discoverContextFiles()` in `output.ts` checks 5 paths. `loadGlobalContextFile()` + `loadContextFileAt()` in `system-prompt.ts` check more paths including `~/.claude/CLAUDE.md` and `<cwd>/.agents/CLAUDE.md` and `<cwd>/.claude/CLAUDE.md`. A file could be loaded into the system prompt but not shown in the banner, confusing users.

4. **Stale TODO comment** — `agent.ts:103` has `cwd, // TODO: What is this used for?` but `cwd` is actively used by commands (skills loading, banner rendering, forked skill execution). The comment should be removed.

5. **Status bar TODOs** — `status-bar.ts` has 3 TODO comments about combining model+thinking effort display and removing `showReasoning` from the status bar (since it's in the banner). These are deferred polish items.

6. **`maxOutputTokens` hardcoded to 16384** — Already tracked in TODO.md. Some models (Claude Opus) support up to 32k output tokens.

7. **`onError` swallows context** — In `turn-request.ts:87`, the `onError` callback is an empty function with a comment about suppressing SDK stderr logging. While the intent is valid, if the stream encounters an error that doesn't propagate through turn events, it could silently fail.

---

## UI/UX Alignment

### Matches idea expectations

- **Banner**: Clean, shows model, cwd, context files, skills count. Matches the idea's "Banner at app start" spec.
- **Status bar**: Model, session ID, git branch, token tracking, context usage with % coloring. Well-formatted with progressive truncation for narrow terminals.
- **Shell output**: Command-specific glyphs (✎ for writes, $ for runs, ← for reads, ? for searches). Stdout/stderr preview with line counts and head/tail truncation. Matches "Shell tool shows the command called and its output."
- **Skill tools**: Compact metadata output as specified.
- **MCP tools**: Clearly distinguishable with ⚙ glyph.
- **One-shot mode**: Clean — no banner, quiet reporter, just the response text.
- **Error recovery**: Returns user to prompt with clear `✖` error messages.
- **16 ANSI colors**: Correctly uses yoctocolors with only the base 16 colors.

### Minor deviations

- **Paste preview** — When pasting text in tmux, the input shows `[pasted: "..."]` preview and requires a separate Enter to submit. This is actually good UX (prevents accidental submissions) but isn't mentioned in the idea file.
- **Reasoning display** — The `· reasoning` blocks from MiniMax render well. The live reasoning block for Claude models renders inline. Both work but look slightly different.

---

## Recommendations

### Immediate bugs

1. **Fix thinking effort for non-thinking models** — `supportsThinking()` should be more specific. Either: (a) differentiate between "model outputs reasoning traces" and "model accepts adaptive thinking API param", or (b) catch the 400 and retry without thinking params, or (c) maintain a deny-list of models that don't support adaptive thinking despite being marked reasoning-capable.

2. **Fix SDK model alias expansion for Zen** — The `claude-3-5-haiku` → `claude-3-5-haiku-20241022` expansion causes 404s. Consider either pinning model IDs in the Zen provider path, or documenting this as a known limitation.

### Code changes

3. **Unify context file discovery** — Extract a shared `contextFileCandidates(cwd, homeDir)` function used by both `discoverContextFiles()` and the system prompt loaders. This fixes the divergence and removes duplication.

4. **Remove stale TODO** — Delete `// TODO: What is this used for? Why is it here?` from `agent.ts:103`.

5. **Address status bar TODOs** — Combine model + thinking effort in the status bar display, decide on showReasoning placement.

### Polish items

6. **Error message for thinking rejection** — When the API rejects thinking params, the generic "API error 400" message doesn't explain why. Extract the error message from the response body and display it in the hint line.

7. **The truncation consolidation** noted in TODO.md (several truncation helpers across cli module files) is a valid cleanup target. `tool-render.ts` and `tool-result-renderers.ts` each have their own `truncate`/`truncateOneLine` functions.
