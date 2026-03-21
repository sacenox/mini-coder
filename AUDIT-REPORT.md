# Audit Report — mini-coder v0.2.0

**Date:** 2026-03-21
**Auditor:** Claude Code (automated audit)
**Scope:** Full codebase review + multi-provider interactive testing + fixes

---

## Summary

### How I tested

- **Code review:** Read every module in `src/` (~15k lines across 130 files). Ran full static check suite (`prettier`, `typecheck`, `lint`, `knip`, `jscpd`, `test`).
- **Multi-provider testing:** Exercised all 5 SDK paths — one-shot and interactive multi-turn sessions with tool calling via tmux:
  - `zen/claude-haiku-4-5` — `@ai-sdk/anthropic` via Zen
  - `zen/gemini-3-flash` — `@ai-sdk/google` via Zen
  - `zen/gpt-5.4-nano` — `@ai-sdk/openai` responses endpoint via Zen
  - `zen/kimi-k2.5` — `@ai-sdk/openai-compatible` via Zen
  - `anthropic/claude-haiku-4-5` — direct Anthropic OAuth
- **Static analysis results:** 296 tests pass, 0 lint issues, 0 type errors, 0 unused exports, 1 minor test-file code clone (0.10%).

### Changes made

1. **Fixed double prompt glyph after ESC interrupt** — Root cause: the shared `ReadableStream` on stdin and `watchForCancel`'s own `process.stdin.on("data")` listener were racing for the same ESC byte, causing `readline()` to receive a ghost ESC and return `{type: "interrupt"}` immediately. Fix: added a gating mechanism (`_stdinGated`) so the ReadableStream drops data while the turn watcher is active.

2. **Fixed leading blank lines in one-shot output** — Models like Kimi/MiniMax that emit leading whitespace in text deltas produced blank lines in one-shot mode. Fix: `trimStart()` on the `responseText` in one-shot output path. (Interactive mode already handles this via `StreamRenderContent.appendTextDelta`'s leading `trimStart`.)

3. **Auto-title sessions from first user message** — Added `autoTitleSession()` that sets the session title to the first line of the first user message (truncated to 60 chars). Called after each successful turn; `setSessionTitle` uses `WHERE title = ''` to only set it once. Session list is now much more useful.

4. **Extracted `mapAssistantParts` helper** — Factored the 9-line boilerplate shared between `stripToolRuntimeInputFields` (shared.ts) and `normalizeOpenAICompatibleToolCallInputs` (openai.ts) into a reusable `mapAssistantParts(messages, transform)` function. Eliminates the jscpd clone.

5. **Removed MiniMax blank lines from KNOWN_ISSUES** — No longer applicable after fix #2.

### Overall assessment

The codebase is in excellent shape. All provider paths work correctly. Architecture closely follows the core idea. Remaining known issues are tracked in `docs/KNOWN_ISSUES.md`.
