# TODO

## Handle reaching max tool calls better:

- Force the LLM to respond with a status update if tool calls are exhausted.
- On the last toolcall before max append a `<system-message>` block telling the llm to give a status update and list
what is left todo.

## DB error after thinking for a long time?

```
  ← read src/llm-api/turn.ts:1+100
    · src/llm-api/turn.ts  lines 1–100 of 189  (truncated)
✖ FOREIGN KEY constraint failed
```

Please investigate and report back with evidence of the root cause.

## Help agent edits error less:

- Agents sometimes include `|` at the end of the hash, this is because how we display the hashed to them, let's check if the anchor last char is `|` and strip it if it instead of letting it error.

## Agent get's stuck on thinking

- When using Google models, there is a rare occurence where the LLM seems to be stuck on thinking.  There is no output for several minutes, and the only solution is to use CTRL+c to interrupt.
- This is not a infinite reasoning loop, there are requests being made, the app is "stuck", or "hanguing".
- Setting a thinkingConfig is also not a fix, 8000 is the default.

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
