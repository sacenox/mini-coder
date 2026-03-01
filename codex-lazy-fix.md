# Codex Lazy Fix Plan

## Analysis: Why Codex Refuses to Work

### Session Evidence

All recent Codex sessions (`zen/gpt-5.3-codex`) were examined from the DB (`~/.config/mini-coder/sessions.db`). The pattern is consistent across every session:

1. **Model receives task** → calls a tool or two (usually `glob` or `read`) showing initial compliance.
2. **Stalls immediately after first exploration** → instead of continuing to implement, outputs a verbose multi-paragraph response saying it *will* do the work, then hands control back to the user.
3. **Ralph mode doesn't help** — In ralph mode the session just re-starts clean each iteration, so the model sees the original prompt again, does 1-2 tool calls, then stalls again and outputs the planning text. The loop repeats without progress. In one session (12 messages), the model read three files and stopped five times asking to "proceed" before the user gave up.

#### Concrete Example (session `mm7yk178-ctvsx`)
```
user: [long plan] "please implement this plan, start working on each turn"
assistant: [glob tool call] → [3x read tool calls]
assistant: "I can't complete that in one pass safely. This is a large multi-workstream refactor...
            Reply **"proceed"** and I'll start implementing batch 1 immediately."
```

The model never wrote a single file. It read files, described what it *would* do, then stopped and asked for permission. Every Codex session ends this same way.

---

### Root Cause: Three Compounding Problems

#### 1. Wrong API endpoint — Chat Completions instead of Responses API

**mini-coder** uses `@ai-sdk/openai` via `createOpenAI()`, which defaults to the **Chat Completions** endpoint (`/v1/chat/completions`).

**OpenAI's own Codex CLI**, **opencode**, and the official [Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide/) all use the **Responses API** (`/v1/responses`). The Responses API is the only supported pathway for GPT-5.x Codex models — the prompting guide explicitly states: *"This model is only supported with the Responses API."*

In opencode's `provider.ts`, for the `openai` provider:
```ts
openai: async () => {
  return {
    autoload: false,
    async getModel(sdk: any, modelID: string) {
      return sdk.responses(modelID)  // ← Responses API, not sdk.chat()
    },
  }
}
```

In mini-coder's `providers.ts`:
```ts
function zenOpenAI() {
  _zenOpenAI = createOpenAI({ apiKey: ..., baseURL: ZEN_BASE })
  // createOpenAI()(...) defaults to chat completions, not responses
}
```

The `@ai-sdk/openai` SDK v3+ exposes `.responses(modelId)` to select the Responses API. mini-coder never calls it — so Codex receives requests on the wrong endpoint. This alone can cause the model to fail or fall back to a degraded behaviour mode.

#### 2. System prompt delivered in wrong position

The Responses API treats the `instructions` field as a high-authority system prompt. A `system`-role message in the `input` array is treated as a lower-priority user turn and **deprioritised** by the model.

mini-coder's `turn.ts` already has partial mitigation — it sends `instructions` via `providerOptions.openai.instructions` for GPT models:
```ts
const useInstructions = systemPrompt !== undefined && isOpenAIGPT(modelString)
// ...
providerOptions: { openai: { instructions: systemPrompt + GPT_CONTINUATION } }
```

However, `isOpenAIGPT` only returns `true` for `zen/*` and `openai/*` prefixes with model IDs starting with `"gpt-"`. The model id `gpt-5.3-codex` does start with `gpt-`, so this *should* be active. But if the Responses API isn't being invoked at all (problem #1), this is moot — the `instructions` field has no effect on Chat Completions.

#### 3. System prompt content drives the stall behaviour

The mini-coder system prompt is terse and generic:
```
Be concise and precise. Avoid unnecessary preamble.
Prefer small, targeted edits over large rewrites.
...
When in doubt, ask the user before making destructive changes.
```

GPT-5.3-Codex is a **reasoning model tuned for agentic autonomy**. Its training specifically rewards:
- Asking for confirmation before proceeding
- Breaking large tasks into batches and requesting approval
- Hedging about "one pass" safety

This is why it keeps stopping and asking "Reply 'proceed'". Its training RLHF pushes it toward collaborative, permission-seeking behaviour unless the system prompt explicitly overrides this with **strong autonomy and persistence directives**.

The official Codex prompting guide is emphatic:
> *"Remove all prompting for the model to communicate an upfront plan, preambles, or other status updates during the rollout, as this can cause the model to stop abruptly before the rollout is complete."*
> *"You should also remove any prompting for the model to communicate an upfront plan, preambles, or other status updates during the rollout."*

mini-coder's prompt has no autonomy directives. The `GPT_CONTINUATION` hint (`"Always make tool calls rather than describing them. Keep going until the task is complete, then stop."`) is a good start, but it's appended to instructions that never reach the model through the correct channel.

---

## Fix Plan

### Fix 1 — Wire the Responses API for Codex/GPT models (critical)

In `src/llm-api/providers.ts`, the `zenOpenAI` and `directOpenAI` factory functions must call `.responses(modelId)` instead of the default `.chat()`:

```ts
// Current (wrong for Codex):
createOpenAI({ apiKey, baseURL })("gpt-5.3-codex")
// → resolves to chat completions endpoint

// Correct:
createOpenAI({ apiKey, baseURL }).responses("gpt-5.3-codex")
// → resolves to Responses API endpoint
```

The `@ai-sdk/openai` provider exposes `sdk.responses(modelId)` to opt into the Responses API. We need to route `gpt-*` models through `.responses()` and leave others on the default.

**Implementation:**
- Add a helper `isGPTModel(modelId: string): boolean` — returns true for `gpt-` prefixed IDs.
- In `resolveModel()`, when provider is `zen` or `openai` and model is a GPT, call `.responses(modelId)` on the created SDK instance.

This mirrors exactly what opencode does in its `CUSTOM_LOADERS.openai` and what official Codex CLI does.

### Fix 2 — Strengthen the Codex-specific system prompt (critical)

Add a Codex-aware system prompt variant in `src/agent/agent.ts` (or a new `src/llm-api/codex-prompt.ts`). When the model is a Codex model, append (or replace) the system prompt with autonomy-first directives drawn from the official Codex prompting guide:

Key additions:
- **Autonomy and persistence**: "Once given a direction, proactively gather context, plan, implement, test, and refine without waiting for additional prompts. Persist until the task is fully handled end-to-end."
- **Bias to action**: "Default to implementing with reasonable assumptions. Do not end your turn with clarifications unless truly blocked."
- **No preambles / no plans**: "Do not output an upfront plan, preambles, or status updates before working. Start working immediately."
- **No asking permission**: "Do not ask 'shall I proceed?' or 'shall I start?'. Start working."

A helper `isCodexModel(modelString: string): boolean` should gate this (e.g., `modelId.includes("codex")`).

### Fix 3 — Add `reasoningEffort` for Codex models (important)

opencode sets `reasoningEffort: "medium"` by default for `gpt-5.*` models, and supports `high`/`xhigh` for Codex. The official guide recommends `"medium"` as the all-around default and `"high"`/`"xhigh"` for hardest tasks.

In `turn.ts`, when building `streamOpts` for a Codex model, include:
```ts
providerOptions: {
  openai: {
    instructions: ...,
    store: false,
    reasoningEffort: "medium",
  }
}
```

### Fix 4 — Strip `itemId` from Responses API messages (correctness)

opencode strips the `itemId` field from items in the `input` array when re-submitting to the Responses API (following what Codex CLI itself does). Without this, the API may reject or misbehave on multi-turn conversations. This should be done at the fetch layer or message serialisation layer.

---

## Implementation Order

1. **Fix 1** — Responses API wiring in `providers.ts` (unblocks everything)
2. **Fix 2** — Codex system prompt additions in `agent.ts` / `turn.ts`  
3. **Fix 3** — `reasoningEffort: "medium"` default in `turn.ts`
4. **Fix 4** — Strip `itemId` from outbound messages (multi-turn correctness)

Fixes 1 and 2 together should be sufficient to get Codex performing. Fixes 3 and 4 are polish/correctness.

---

## Files to Change

| File | Change |
|---|---|
| `src/llm-api/providers.ts` | Route `gpt-*` through `.responses()` for `zen`/`openai` providers |
| `src/llm-api/turn.ts` | Add `reasoningEffort`, update `isOpenAIGPT` to cover codex, strip itemIds |
| `src/agent/agent.ts` | Add Codex-specific autonomy directives to system prompt when Codex model detected |

No new dependencies needed — `@ai-sdk/openai` already exposes `.responses()`.
