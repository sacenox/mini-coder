#TODO

---

# Missing version on globally installed binary

Investigate why when I use the global installed binary, the version appears as:

```sh
❯ mc   

  mc  mini-coder · vunknown
  zen/claude-sonnet-4-6  ·  /Users/seancaetanomartin/src/mini-coder
  /help for commands  ·  ctrl+d to exit

· MCP: connected exa
```

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
