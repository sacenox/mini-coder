# TODO

## Gemini models sometimes get stuck "thinking" forever

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

Skills:

- Should autocomplete from global `~/.agents/skills` and the local agents folder.

Custom Agents:

- [Claude's flow](https://code.claude.com/docs/en/sub-agents)
- [Opencode's flow](https://opencode.ai/docs/agents/#options)

Let's implement our own with config in `~/.agents/agents/`. Skip the `/agent` command.

---

Custom commands:

https://opencode.ai/docs/commands/ I want to copy this approach to custom commands.

Let's also create a local command to this repo, `/search` that fires a small model to explore the codebase for the arguments given.

DO NOT make a new config structure! use `~/.agents/` for global commands and the local version `./.agents/` for repo commands.
