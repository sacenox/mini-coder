#TODO

---

Investigate crash:

```
            "content",
            2
          ],
          "message": "Invalid input"
        }
      ]
    ],
    "path": [
      22
    ],
    "message": "Invalid input"
  }
]
      at new ZodError (/Users/seancaetanomartin/src/mini-coder/node_modules/zod/v4/core/core.js:39:39)
      at <anonymous> (/Users/seancaetanomartin/src/mini-coder/node_modules/zod/v4/core/parse.js:53:20)
      at <anonymous> (/Users/seancaetanomartin/src/mini-coder/node_modules/zod/v4/core/parse.js:45:49)
      at <anonymous> (/Users/seancaetanomartin/src/mini-coder/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2070:33)
      at validate (/Users/seancaetanomartin/src/mini-coder/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2069:24)
      at safeValidateTypes (/Users/seancaetanomartin/src/mini-coder/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2109:39)
      at safeValidateTypes (/Users/seancaetanomartin/src/mini-coder/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2099:33)
      at standardizePrompt (/Users/seancaetanomartin/src/mini-coder/node_modules/ai/dist/index.mjs:2045:34)
      at standardizePrompt (/Users/seancaetanomartin/src/mini-coder/node_modules/ai/dist/index.mjs:2005:34)
      at <anonymous> (/Users/seancaetanomartin/src/mini-coder/node_modules/ai/dist/index.mjs:6746:37)
      at fn (/Users/seancaetanomartin/src/mini-coder/node_modules/ai/dist/index.mjs:6744:18)
      at <anonymous> (/Users/seancaetanomartin/src/mini-coder/node_modules/ai/dist/index.mjs:2241:38)
      at <anonymous> (/Users/seancaetanomartin/src/mini-coder/node_modules/ai/dist/index.mjs:2238:12)

✖ Invalid prompt: The messages do not match the ModelMessage[] schema.
claude-sonnet-4-6  mlzi8xij  ~/src/mini-coder  ⎇ main  ↑2244.6k ↓8.1k
▶ 
```

We should check the db for what was the last call before the errors.
Session id: `mlzi8xij-kpq0o (untitled)            claude-sonnet-4-6 ~/src/mini-coder  2/23/2026, 8:36:03 PM`

Write a report of the findings to the repo root.

---

I want to add a ralph loop command `/ralph`.  It works as a toggle like plan.

Let's explore existing implementations and come up with a concrete plan

https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum
https://github.com/vercel-labs/ralph-loop-agent/tree/main/packages/ralph-loop-agent/src

---

## Gemini 3.1 sometimes gets stuck "thinking"

I've seen it a couple times, where after a tool call, gemini 3.1 pro will get stuck
with the UI only showing the thinking animated icon.  A ctrl+c will complete it's turn and then it will continue to work like nothing happened.

- Happens to all google models using Zen provider (dont have a google key to try direct)
- The user did not cancel with CTRL+c, they pressed it after thinking was stuck for over 30m(!!!!!!)
- When using other coding agents, Gemini 3.1 pro doesn't have this issue

- Check online for new SDK version that supports Gemini 3.1 Pro/API changes.
- https://github.com/vercel/ai/issues/12367 Is not a known issue, it was confirmed to be a bug with an unrelated library. The only thing to note is this change:

```ts
// SDK 5
streamText({ maxSteps: 5 })

// SDK 6
import { stepCountIs } from 'ai';
streamText({ stopWhen: stepCountIs(5) })
```

We should start by checking if the google ai sdk has updates.

---

## `/model` thinking-effort toggle

The idea specifies: *"/model allows the user to pick a model as well as thinking
effort for the model if supported. Selection persists across sessions."*

`runTurn()` in `src/llm-api/turn.ts` builds `streamOpts` with no `providerOptions`,
so thinking effort is never forwarded to the SDK. The `settings` table (via
`getSetting`/`setSetting` in `src/session/db.ts`) is already available for
persistence alongside `preferred_model`.

**Fix:**
- Add `thinkingEffort?: "low" | "medium" | "high"` to `runTurn()` options and pass
  it as `providerOptions` — e.g. for Anthropic:
  `{ anthropic: { thinking: { type: "enabled", budgetTokens: N } } }`.
- Expose it in `/model` (e.g. `/model --effort high`) and persist to `settings`
  with key `"thinking_effort"`.
- Read it back in `agent.ts` (alongside `getPreferredModel()`) and thread it into
  every `runTurn()` call including subagents.
- Gate display in `/model` listing to models that support it (Claude 3.5+ Sonnet /
  Opus, o-series OpenAI models). Add a capability flag in `providers.ts`.

---

## `@` references for global skills / agent configs

The idea says: *"Reference files, skills, agents from the working directory and
global community configs with `@` in prompt input."*

Currently `getFileCompletions()` in `src/cli/input.ts` only scans `cwd` with
`Bun.Glob`, and `resolveFileRefs()` in `src/agent/agent.ts` (line 501) only reads
files relative to `cwd` or as absolute paths. Global skill/agent files under
`~/.agents/` (the convention referenced in the idea from `skills.sh`) are never
surfaced.

**Fix:**
- Extend `getFileCompletions()` to also scan `~/.agents/` for skill/agent files and
  surface them as `@~/.agents/<name>` completions alongside local results.
- In `resolveFileRefs()`, resolve `@`-refs that start with `~/` or match a known
  global skill name against `homedir() + "/.agents/"` in addition to `cwd`.
- Optionally distinguish global refs visually in Tab-completion output.
