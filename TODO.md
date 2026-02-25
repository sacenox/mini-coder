# TODO

# Zod/Schema error: 

likely fixed by https://github.com/sacenox/mini-coder/commit/d27dccbf6ca2ced4f05d493701da9d8fe809e05d

A user reported this issue, seems like we are trying to use a wrong type? Please see what you can find in the code

```
gpt-5.3-codex  mm2h8qwl  ~/code/personal/mini-coder  ⎇ main
▶ right now I can use opt+left/right to navigate between words. I'd like to do the same for delete. Eg: opt+delete to delete single words.
  ? glob **/*
    · src/session/manager.ts
    · src/session/db.ts
    · src/llm-api/types.ts
    · src/mcp/client.ts
    · src/tools/subagent.ts
    · src/llm-api/providers.ts
    · src/llm-api/turn.ts
    · src/cli/output.ts
    · src/cli/skills.test.ts
    · src/cli/skills.ts
    · src/cli/commands.ts
    · src/cli/input.ts
      +51 more
⠼ thinking333 |   }) {
334 |     var _a15, _b15, _c;
335 |     if (_TypeValidationError.isInstance(cause) && cause.value === value && ((_a15 = cause.context) == null ? void 0 : _a15.field) === (context == null ? void 0 : context.field) && ((_b15 = cause.context) == null ? void 0 : _b15.entityName) === (context == null ? void 0 : context.entityName) && ((_c = cause.context) == null ? void 0 : _c.entityId) === (context == null ? void 0 : context.entityId)) {
336 |       return cause;
337 |     }
338 |     return new _TypeValidationError({ value, cause, context });
                 ^
AI_TypeValidationError: Type validation failed: Value: {"type":"ping","cost":"0.00387975"}.
Error message: [
  {
    "code": "invalid_union",
    "errors": [
      [
        {
          "expected": "array",
          "code": "invalid_type",
          "path": [
            "choices"
          ],
          "message": "Invalid input: expected array, received undefined"
        }
      ],
      [
        {
          "expected": "object",
          "code": "invalid_type",
          "path": [
            "error"
          ],
          "message": "Invalid input: expected object, received undefined"
        }
      ]
    ],
    "path": [],
    "message": "Invalid input"
  }
]
      value: {
  type: "ping",
  cost: "0.00387975",
},
    context: undefined,
 vercel.ai.error: true,
 vercel.ai.error.AI_TypeValidationError: true,

      at wrap (/Users/ericskram/.bun/install/global/node_modules/@ai-sdk/provider/dist/index.mjs:338:12)
      at safeValidateTypes (/Users/ericskram/.bun/install/global/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2115:35)
      at async safeParseJSON (/Users/ericskram/.bun/install/global/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2154:18)
      at async transform (/Users/ericskram/.bun/install/global/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2186:34)

25 |     class Definition extends Parent {
26 |     }
27 |     Object.defineProperty(Definition, "name", { value: name });
28 |     function _(def) {
29 |         var _a;
30 |         const inst = params?.Parent ? new Definition() : this;
                                           ^
ZodError: [
  {
    "code": "invalid_union",
    "errors": [
      [
        {
          "expected": "array",
          "code": "invalid_type",
          "path": [
            "choices"
          ],
          "message": "Invalid input: expected array, received undefined"
        }
      ],
      [
        {
          "expected": "object",
          "code": "invalid_type",
          "path": [
            "error"
          ],
          "message": "Invalid input: expected object, received undefined"
        }
      ]
    ],
    "path": [],
    "message": "Invalid input"
  }
]
      at new ZodError (/Users/ericskram/.bun/install/global/node_modules/zod/v4/core/core.js:30:39)
      at <anonymous> (/Users/ericskram/.bun/install/global/node_modules/zod/v4/core/parse.js:53:20)
      at <anonymous> (/Users/ericskram/.bun/install/global/node_modules/zod/v4/core/parse.js:45:49)
      at <anonymous> (/Users/ericskram/.bun/install/global/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2070:33)
      at validate (/Users/ericskram/.bun/install/global/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2069:24)
      at safeValidateTypes (/Users/ericskram/.bun/install/global/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2109:39)
      at safeValidateTypes (/Users/ericskram/.bun/install/global/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2099:33)
      at safeParseJSON (/Users/ericskram/.bun/install/global/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2154:18)
      at safeParseJSON (/Users/ericskram/.bun/install/global/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2145:29)
      at transform (/Users/ericskram/.bun/install/global/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2186:34)
      at transform (/Users/ericskram/.bun/install/global/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2182:25)
```


## Streaming subagent activity

I'd like to have the subgent output/activity to be streamed to the main output.  Right now we wait for the subagent to be complete to print all at once

## Implement WebContent and WebSearch using exa.ai api

Why not just keep using them via their MCP? Simple answer: their tools descriptions/schema is bloated with params that don't concern the llm. They are also misleading in their naming conventions, futher worsening the issue.  Let's use their api (let's auto discover the api key like we do for other providers "EXA_AI_API_KEY") and if Exa is enabled, the tools are given to the LLM.

https://exa.ai/docs/reference/search-quickstart
https://exa.ai/docs/reference/contents-quickstart
**Ask the user for text versions if you can't find these pages**

## Subagents don't have access to MCP tools?

Investigate if subagents are able to see the mcp tools. The user reported that after adding the exa mcp tools, that the subagents claimed to not be able to search online, but the main agent could.

## Investigate missing output?

```
Summary of the design:
1. Skills (`~/.agents/skills/*/SKILL.md` + `.agents/skills/*/SKILL.md`): `@skill-name` in prompt → loads skill content into context. Tab-autocomplete from both global and local skill dirs.
2. Custom Agents (`~/.agents/agents/*.md` + `.agents/agents/*.md`): `@agent-name` in prompt → runs that agent as a subagent with its custom system prompt/model. YAML frontmatter with `description`, `model`.
^C3. Tab completion in input.ts should show `@skill-name` and `@agent-name` suggestions alongside file completions.

[BIG WAIT HERE, nothing happening for 10m+, user used CTRL+c to return to prompt]

claude-sonnet-4-6  mm1v6tyb  ~/src/mini-coder  ⎇ main  ctx 55.9k/200.0k 28%  ↑182.1k ↓949
▶ What happened?
◆ I'm mid-way through exploring the codebase to implement your `@` references feature for skills and custom agents. Here's what I've gathered so far:
```

LLM said it was exploring but no output or tool calls were seen. Session continued normally after the "What happened?" message. (mm1v6tyb session id)

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
