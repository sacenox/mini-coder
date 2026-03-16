# UI Audit Refactor

We're on branch `refactor/ui-audit` doing the UI Audit from TODO.md.

## Goals

- Revise all console output for consistency, **performance**, and correctness.
- Ensure clear styled output with proper hierarchy — different output types (user, assistant, reasoning, tool calls, tool results, errors) must be clearly distinguishable via styles and whitespace.
- Ensure proper spinner functionality — follow-up messages don't render inline, nothing breaks.
- Ensure conversation log is logical — user, assistant, reasoning, tools/tool calls/results are clearly labelled and associated for readability.

## Key rendering files

- `src/cli/output.ts` — Glyphs (`G`), banner, error rendering, `CliReporter`
- `src/cli/tool-render.ts` — Tool call lines + tool result dispatch
- `src/cli/tool-result-renderers.ts` — Per-tool result formatting (shell, subagent, skills, web, MCP)
- `src/cli/stream-render.ts` — Main turn event loop — orchestrates text, reasoning, tools, spinner
- `src/cli/stream-render-content.ts` — Text/reasoning delta accumulation + markdown highlighting
- `src/cli/live-reasoning.ts` — Streamed reasoning block display
- `src/cli/spinner.ts` — Braille spinner on stderr
- `src/cli/status-bar.ts` — Model/session/token info bar

## Testing approach

- Use `simulateTerminal()` + captured stdout for "user perspective" tests (handles cursor rewrites).
- Test with `stripAnsi()` for structure, `hasAnsi()` for styling assertions.
- Test realistic multi-event sequences through `renderTurn()` to catch spacing/hierarchy issues.
- Verify indentation levels, blank line separators, glyph prefixes, spinner clears.

## Status

- [x] Baseline tests for current output (24 tests in ui-audit.test.ts)
- [x] Shared test helpers in test-helpers.ts (captureStdout, simulateTerminal, eventsFrom, etc.)
- [x] Parallel tool call tests (5 tests)
- [x] Manual one-shot script (scripts/ui-oneshot.ts, 14 scenarios) — run: bun run ui-oneshot
- [x] Identify inconsistencies and issues from one-shot output
- [x] Refactor rendering for consistency
- [x] Verify all tests pass

## Issues found and fixed

1. **Parallel tool calls had blank lines between them** — consecutive tool-call-start events
   in a batch each triggered a blank line separator, making parallel calls look disconnected.
   Fixed by detecting consecutive tool calls and skipping the blank line within a batch.

2. **Web tools used generic glyph/label** — `webSearch` and `webContent` fell through to the
   generic `· toolName` renderer. Added dedicated rendering: `? search <query>` and
   `← fetch <url>` with proper glyphs.

3. **Missing one-shot scenarios** — added scenarios 15-17 for webSearch, webContent, and
   listSkills to ensure visual coverage of all tool types.
