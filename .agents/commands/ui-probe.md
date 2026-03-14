---
description: Run one-shot mc sessions across all SDK paths, capture output, and write a UI/UX analysis report to UI-REPORT.md.
---

The goal is to capture a realistic perspective of what the users see when using mini-coder.

Run `mc` one-shots using one cheap model per Zen SDK path, capture their raw terminal output, then analyse it yourself and write `UI-REPORT.md` in the repo root. Do NOT delegate the report to the models under test.

## Models to use (one per SDK path)

Pick cheap/free options. Verify available models at https://opencode.ai/docs/zen/ if needed, then choose:

- `@ai-sdk/anthropic` path → a `zen/claude-*` haiku-class model
- `@ai-sdk/google` path → a `zen/gemini-*` flash-class model
- `@ai-sdk/openai` path (responses endpoint) → a `zen/gpt-*` small low cost model
- `@ai-sdk/openai-compatible` path → `zen/*` or similar small low cost model

Avoid free models due to rate limit issues.

## Prompt to give each model

```
Read mini-coder-idea.md and TODO.md, then create mc-summary.md in the repo root with a short summary of what mini-coder is and a list of the key TODO items.
```

This prompt is intentionally simple: it covers file reads, a write, and exposes path resolution, spinner, error handling, and output formatting behaviour.

## Steps

1. Create `logs/` in the repo root if it doesn't exist.
2. For each model, run:
   ```
   mc -m <model> "<prompt>" > logs/<model>.log 2>&1
   ```
   Run them sequentially (not in parallel) to avoid SQLite lock issues.
3. Strip ANSI escape codes from each log for clean reading:
   ```
   sed 's/\x1b\[[0-9;?]*[mKlh]//g; s/\r//g' logs/<model>.log > logs/<model>-clean.log
   ```
4. Read all clean logs yourself and analyse what a user would actually see.
5. Clean up any `mc-summary.md` files left behind by the test models. And the log files

## Report structure for UI-REPORT.md

Write `UI-REPORT.md` in the repo root with these sections:

- **Methodology** — models tested, prompt used, how output was captured
- **Per-model results** — for each model: did it complete the task? what did the user see step by step? any errors or recovery detours?
- **Shared UI observations** — patterns across all models: spinner behaviour, tool call chrome (symbols, indentation), reasoning block display, diff output, final response format, banner/status bar presence
- **UI/UX** how can it be improved, is the output elegant, clear and hierchial?
- **Bugs found** — table: severity, description, likely source file
- **Alignment with mini-coder-idea.md** — table comparing each idea goal against what was observed (✅ / ⚠️ / ❌)
- **Recommendations** — split into immediate bugs and polish items

Use `mini-coder-idea.md` and `TODO.md` as the source of truth for what the UI _should_ look like.
The report is analysis only — no code changes.
