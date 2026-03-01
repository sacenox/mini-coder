# TODO

## Help agent edits error less:

- Agents sometimes include `|` at the end of the hash, this is because how we display the hashed to them, let's check if the anchor last char is `|` and strip it if it instead of letting it error.

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
