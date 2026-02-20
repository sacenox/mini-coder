# Undo needs to restore working directory

Besides undoing the conversation turn, it should restore some snapshot, using git?

---

Subagent needs visibity on the ui somehow... that accounts for multiple in parallel... Needs planning

---

# Plan mode changes

- Allow read tools + mcp
- When plan mode is on, add a `<system-message>PLAN MODE ACTIVE -- READ ONLY</system-message>` suffix to the user messages.

---

# LLMs don't know their cwd:

```
▶ create a readme file and introduce yourself
  ✎ create README.md
    ✖ EACCES: permission denied, mkdir '/root/src/mini-coder'
  ✎ create README.md
    ✖ EACCES: permission denied, mkdir '/home/sandbox'
  $ $ pwd
    ✔ 0
    │ /home/xonecas/src/mini-coder
  ✎ create README.md
```

---

claude-sonnet-4-6  ~/src/mini-coder  ↑40.4k ↓125
▶ Where in the code is it setting the default model?
  ? grep default.*model|model.*default  i
    PLAN.md:174  "defaultModel": "zen/claude-sonnet-4-6",
    src/tools/subagent.ts:13  "Defaults to the current model."
    src/llm-api/providers.ts:198  * Returns the first available (provider, defaultModel) pair.
  ← read src/llm-api/providers.ts:195–220
    · src/llm-api/providers.ts  lines 195–220 of 288  (truncated)
◆ It's in **`src/llm-api/providers.ts`**, the `autoDiscoverModel()` function (line 200). It picks the default model based on which API key env vars are present, in priority order:

| Env Var | Default Model |
|---|---|
| `OPENCODE_API_KEY` | `zen/claude-sonnet-4-6` |
| `ANTHROPIC_API_KEY` | `anthropic/claude-sonnet-4-5-20250929` |
| `OPENAI_API_KEY` | `openai/gpt-4o` |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | `google/gemini-2.0-flash` |
| *(none)* | `ollama/llama3.2` (fallback) |

---
