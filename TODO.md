# TODO

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
