# TODO

## Help agent edits error less:

- Agents sometimes include `|` at the end of the hash, this is because how we display the hashed to them, let's check if the anchor last char is `|` and strip it if it instead of letting it error.

## Implement WebContent and WebSearch using exa.ai api

Why not just keep using them via their MCP? Simple answer: their tools descriptions/schema is bloated with params that don't concern the llm. They are also misleading in their naming conventions, futher worsening the issue.  Let's use their api (let's auto discover the api key like we do for other providers "EXA_API_KEY") and if Exa is enabled, the tools are given to the LLM.

https://exa.ai/docs/reference/search-quickstart
https://exa.ai/docs/reference/contents-quickstart
**Ask the user for text versions if you can't find these pages**

## Agent get's stuck on thinking

- When using Google models, there is a rare occurence where the LLM seems to be stuck on thinking.  There is no output for several minutes, and the only solution is to use CTRL+c to interrupt.
- This is not a infinite reasoning loop, there are requests being made, the app is "stuck", or "hanguing".
- Setting a thinkingConfig is also not a fix, 8000 is the default.

## Fucking shit ctrl+c still doesn't work how the fuck is this possible:

Agent got stuck on thinking after calling the shell tool, using ctrl+c exitted the app... This is un-acceptable, see the git history, ctrl+c has been broken and there have been several claims to fixing it. The truth is that it doesn't work at all. I'm fucking done with this bullshit, either it works this time, or we are moving interrupt to a different key. This is fucking stupid...

```
◆ I have updated `src/tools/exa.ts` to address both issues:

1. Context Window Vulnerabilities: Added a constraint to the URLs array length in the `ExaContentSchema` by chaining `.max(3)` so the agent won't fetch more than 3 URLs at a time. Also, changed `text: true` to `text: { maxCharacters: 10000 }` to avoid returning overly large payloads.
2. Swallowed Error Details: Extracted the error body (`await response.text()`) and included it in the thrown `Error` for both `webSearchTool` and `webContentTool`, providing detailed visibility into API failures.

All code checks and tests passed successfully.
gemini-3.1-pro  mm7kimxq  ~/src/mini-coder  ⎇ main  ctx 46.4k/1000.0k 5%  ↑1033.7k ↓8.6k
▶ ok make a commit
  $ $ git add src/tools/exa.ts src/agent/tools.ts && git commit -m "feat: i…
    ✔ 0
    │ [main a30a472] feat: implement native Exa web search and content tools
    │  2 files changed, 102 insertions(+), 2 deletions(-)
    │  create mode 100644 src/tools/exa.ts
  $ $ git push
    ✔ 0
    │ To github.com:sacenox/mini-coder.git
    │    9348b39..a30a472  main -> main
error: script "dev" exited with code 130
```

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
