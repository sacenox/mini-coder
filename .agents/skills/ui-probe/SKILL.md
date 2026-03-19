---
name: ui-probe
description: Run one-shot mc sessions across all SDK paths, capture output, and write a UI/UX analysis report to UI-REPORT.md.
---

The goal is to capture a realistic perspective of what the users see when using mini-coder. And ensure the core idea (mini-coder-idea.md) is well executed in the output.

Run `mc` using one cheap modern model per provider path, capture their raw terminal output, then analyse it yourself and write `UI-REPORT.md` in the repo root.
Do NOT delegate the report to the models under test.
Use `tmux` so you can test interactive sessions properly. Remember to send Enter to submit, and careful with the paste handling.

## Models to use (one per SDK path)

Pick cheap options. Verify available models at https://opencode.ai/docs/zen/, then choose:

- `@ai-sdk/anthropic` path → a `zen/claude-*` haiku-class model
- `@ai-sdk/google` path → a `zen/gemini-*` flash-class model
- `@ai-sdk/openai` path (responses endpoint) → a `zen/gpt-*` small low cost model
- `@ai-sdk/openai-compatible` path → `zen/*` or similar small low cost model

Avoid free models due to rate limit issues.
Also use a Anthropic Oauth model for completness

## Prompt to give each model

Use prompts that will ensure a realistic pattern, using multi steps and turns. Check the db for examples if needed.

## Report structure for UI-REPORT.md

Write `UI-REPORT.md` in the repo root with these sections:

- **Summary** -- a short summary of how you tested and what your found.
- **Alignment with mini-coder-idea.md** -- Comparison summary, avoid using tables.
- **Recommendations** -- split into immediate bugs and polish items

Don't be verbose, be concise in your report.

Use `mini-coder-idea.md` and `TODO.md` as the source of truth for what the UI _should_ look like.
The report is analysis only — no code changes.
