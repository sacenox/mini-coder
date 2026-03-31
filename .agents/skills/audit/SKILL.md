---
name: audit
description: "Full codebase audit — code review, multi-provider UI testing, and combined report. Use when the user asks to audit, test across providers, or validate the full implementation. Triggers on: audit, full review, test providers, validate implementation."
compatibility: "Requires tmux, bun, git, and active provider credentials (OpenAI OAuth and/or Opencode zen)"
---

Run a complete audit of the mini-coder implementation.

## Phase 1 — Code & architecture review

Audit the codebase against the project's core idea (the source of truth for design):

1. Read the core idea section in AGENTS.md (or the system prompt context). And the KNOWN_ISSUES.md files.
2. Walk through each module and question design choices — stay compliant with the original idea.
3. Employ KISS, DRY, and YAGNI — flag surprise additions or eager optimizations.
4. Check `TODO.md` for known issues already tracked — don't duplicate them.
5. Verify documentation matches the idea file.

Use `bun run dev` and `tmux` via shell to run one-shot and interactive sessions manually. Analyse console output and UI from a user's perspective. Follow the **tmux send-keys rules** in Phase 2 whenever interacting with tmux.

## Phase 2 — Multi-provider UI probe

Run `mc` sessions across all SDK paths to capture what real users see.
Do NOT delegate analysis to the models under test.
Use `tmux` so you can test interactive sessions properly.

**tmux rules** (always follow these):

- **Session naming**: always prefix tmux session names with `mc-audit-` (e.g. `mc-audit-haiku`, `mc-audit-gemini`). Never use generic names like `audit`, `test`, or `s` — they may collide with the host tmux session and kill the running mc process.
- Always use `-l` when sending text: `tmux send-keys -t <session> -l 'your text here'`
- Send `Enter` as a **separate** call without `-l`: `tmux send-keys -t <session> Enter`
- Never combine text and `Enter` in a single `send-keys` call — without `-l`, words like `Enter`, `Escape`, `Tab`, `Space` get interpreted as key presses instead of literal text.
- Pattern: `tmux send-keys -t mc-audit-test -l 'text'` then `tmux send-keys -t mc-audit-test Enter`
- Before creating a session, never run `tmux kill-session` or `tmux kill-server` — just use unique names.

### Models to use (one per SDK path)

Opencode zen and Openai login are available in this environment.
Pick cheap options. Verify available models at https://opencode.ai/docs/zen/, then choose:

- `@ai-sdk/anthropic` path → a `zen/claude-*` haiku-class model
- `@ai-sdk/google` path → a `zen/gemini-*` flash-class model
- `@ai-sdk/openai` path (responses endpoint) → a `zen/gpt-*` small low-cost model
- `@ai-sdk/openai-compatible` path → `zen/*` or similar small low-cost model

Avoid free models due to rate limit issues.
Also use an Openai OAuth model for completeness.

### Prompts

Use prompts that exercise realistic multi-step, multi-turn patterns. Check the db for examples if needed.

## Phase 3 — Report

Write `AUDIT-REPORT.md` in the repo root with these sections:

- **Summary** — how you tested and what you found.
- **Code & Architecture** — correctness issues, KISS/DRY/YAGNI violations, idea misalignment.
- **UI/UX Alignment** — comparison of actual output vs the core idea's expectations across providers.
- **Recommendations** — split into immediate bugs, code changes, and polish items.

Don't just recite the todo or known issues items back to the user — report on the audit itself and new findings.
Be concise. The report is analysis only — review findings with the user before making any changes.
