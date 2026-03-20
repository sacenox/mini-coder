---
name: audit
description: Full codebase audit — code review, multi-provider UI testing, and combined report.
---

Run a complete audit of the mini-coder implementation.

## Phase 1 — Code & Architecture Review

Audit the codebase against the core idea:

- Question design choices and rethink as needed while staying compliant with the original idea.
- Employ KISS, DRY, and YAGNI — no surprise additions or eager optimizations.
- Check TODO.md for known issues already tracked.
- Verify all documentation matches the idea file.

Use `bun run dev` and `tmux` via shell to run one-shot and interactive sessions manually. Analyze console output and UI from a user's perspective.

## Phase 2 — Multi-Provider UI Probe

Run `mc` sessions across all SDK paths to capture what real users see.
Do NOT delegate analysis to the models under test.
Use `tmux` so you can test interactive sessions properly. Remember to send Enter to submit, and be careful with paste handling.

### Models to use (one per SDK path)

Opencode zen and Anthropic login are available in this environment.
Pick cheap options. Verify available models at https://opencode.ai/docs/zen/, then choose:

- `@ai-sdk/anthropic` path → a `zen/claude-*` haiku-class model
- `@ai-sdk/google` path → a `zen/gemini-*` flash-class model
- `@ai-sdk/openai` path (responses endpoint) → a `zen/gpt-*` small low cost model
- `@ai-sdk/openai-compatible` path → `zen/*` or similar small low cost model

Avoid free models due to rate limit issues.
Also use an Anthropic OAuth model for completeness.

### Prompts

Use prompts that exercise realistic multi-step, multi-turn patterns. Check the db for examples if needed.

## Phase 3 — Report

Write `AUDIT-REPORT.md` in the repo root with these sections:

- **Summary** — how you tested and what you found.
- **Code & Architecture** — correctness issues, KISS, DRY, and YAGNI violations, idea misalignment.
- **UI/UX Alignment** — comparison of actual output vs the core idea's expectations across providers.
- **Recommendations** — split into immediate bugs, code changes, and polish items.

Don't just recite the todo items back to the user, report on the audit itself.
Be concise. The report is analysis only — review findings with the user before making any changes.
