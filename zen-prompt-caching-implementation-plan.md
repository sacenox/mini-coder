# Zen prompt caching implementation plan

## Summary

Goal: assume Zen forwards the same provider-specific cache settings that the Vercel AI SDK supports, and update mini-coder so Zen requests actually use prompt caching where possible.

The key conclusion from the code review is that we already have most of the plumbing needed for **top-level provider options**, but we do **not** currently have:

- any cache-specific settings or request shaping
- any per-message provider-option injection for Anthropic cache breakpoints
- any Gemini explicit-cache lifecycle support
- a stable system prompt prefix suitable for cache reuse

The last point is the biggest blocker: `buildSystemPrompt()` currently injects a fresh `Current date/time` string on every turn, which makes the prompt prefix change every turn and substantially defeats provider-side prefix caching.

## Findings

### 1) Zen already runs through the same provider SDKs that expose cache settings

Mini-coder routes Zen models through the same AI SDK providers Zen recommends:

- `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai` are installed in `package.json:22-24`
- Zen Anthropic provider factory: `src/llm-api/providers.ts:70-79`
- Zen OpenAI provider factory: `src/llm-api/providers.ts:82-91`
- Zen Google provider factory: `src/llm-api/providers.ts:94-103`

That means the implementation path is to change **request construction**, not provider selection.

### 2) `runTurn()` already has a top-level provider-options merge point

The main request path is in `src/llm-api/turn.ts:644-824`.

Important pieces:

- current request options are assembled in `mergedProviderOptions` at `src/llm-api/turn.ts:749-772`
- those options are passed into `streamText()` at `src/llm-api/turn.ts:811-813`
- the final call is `streamText(streamOpts)` at `src/llm-api/turn.ts:824`

This is already sufficient for providers that accept cache settings at the **function-call level**:

- OpenAI prompt caching settings
- Google `cachedContent`

It is **not** sufficient for Anthropic prompt caching, because Anthropic cache control is attached to **messages / content blocks**, not just the top-level call.

### 3) The current system prompt shape is hostile to cache reuse

`buildSystemPrompt()` is rebuilt on every turn in `src/agent/session-runner.ts:161-166`.

Inside that function, the prompt includes:

- working directory: `src/agent/system-prompt.ts:84-91`
- **current date/time** via `new Date().toLocaleString(...)`: `src/agent/system-prompt.ts:85`

Because that timestamp changes every turn, the repeated prefix is not stable across turns. Even if Zen/OpenAI/Anthropic support provider-side prompt caching, the changing timestamp makes the highest-value prefix differ near the top of the prompt.

This should be treated as a required prerequisite for meaningful caching.

### 4) Anthropic needs message-level request shaping that we do not have today

Right now, the request uses:

- `messages: turnMessages` at `src/llm-api/turn.ts:776`
- optional top-level `system` at `src/llm-api/turn.ts:810`
- optional top-level `providerOptions` at `src/llm-api/turn.ts:811-813`

There is currently no helper that walks `CoreMessage[]` and annotates specific messages or parts with provider options.

That matters because Anthropic prompt caching needs `cacheControl` attached to stable prefix content rather than only to the whole request.

### 5) Message persistence is already compatible with cache metadata

Lossless message persistence is already a design invariant:

- save verbatim JSON: `src/session/db/message-repo.ts:16-23`
- load verbatim JSON: `src/session/db/message-repo.ts:62-78`
- runner preserves model-authored message shape: `src/agent/session-runner.ts:198-203`

This is good news for caching because provider metadata on messages or content parts can survive round-trips if we need it.

### 6) Existing history sanitizers are not a blocker, but they must be respected

Before requests are sent, history passes through:

- Gemini tool-message sanitization: `src/llm-api/turn.ts:693-707`
- GPT commentary stripping: `src/llm-api/turn.ts:709-715`
- OpenAI item-id stripping: `src/llm-api/turn.ts:717-723`
- context pruning: `src/llm-api/turn.ts:729-736`
- tool-result compaction: `src/llm-api/turn.ts:738-747`

Any cache annotation helper must run **after** the structural sanitizers that intentionally rewrite history, otherwise the cache annotations can be dropped or attached to messages that later get removed.

### 7) Gemini explicit caching is only partially supported by the current stack

The AI SDK Google provider supports `providerOptions.google.cachedContent`, which matches our existing top-level provider-options plumbing.

However, mini-coder currently has no code that creates or refreshes Gemini cache objects. So for Gemini there are two different scopes:

- **MVP**: support passing a pre-created `cachedContent` reference
- **follow-up**: create/manage Gemini cache objects automatically

The MVP is easy. The full lifecycle is not.

## Provider-by-provider implementation impact

### OpenAI / Zen GPT models

Expected to be the easiest path.

What the code already gives us:

- Zen GPT models go through `@ai-sdk/openai` Responses API routing: `src/llm-api/providers.ts:49-53`, `src/llm-api/providers.ts:82-91`
- request-level provider options already exist: `src/llm-api/turn.ts:749-813`

What to add:

- `providerOptions.openai.promptCacheRetention`
- optional `providerOptions.openai.promptCacheKey`

Main caveat:

- cache benefit is weak until the system prompt is made stable across turns

### Anthropic / Zen Claude models

Expected to require the most custom request shaping.

What the code already gives us:

- Zen Claude models go through `@ai-sdk/anthropic`: `src/llm-api/providers.ts:49-50`, `src/llm-api/providers.ts:70-79`
- messages are preserved losslessly in history and DB

What is missing:

- no message/part-level cache annotations
- top-level `system` prompt cannot currently carry Anthropic message-level cache control in our code path

Likely implementation shape:

- convert the request construction for Anthropic-family models so the stable system prompt is sent as a **system message** in `messages`, not only as the top-level `system` field
- annotate that system message and the chosen stable-prefix message(s) with Anthropic `cacheControl`
- keep the non-Anthropic path unchanged

### Google / Zen Gemini models

What the code already gives us:

- Zen Gemini models go through `@ai-sdk/google`: `src/llm-api/providers.ts:49-53`, `src/llm-api/providers.ts:94-103`
- request-level provider options already exist: `src/llm-api/turn.ts:749-813`

What is missing:

- no cache-id source in config/settings
- no explicit cache object creation lifecycle

Practical conclusion:

- supporting a manually supplied `cachedContent` reference is straightforward
- fully automatic explicit Gemini caching should be treated as phase 2, not phase 1

## Proposed implementation approach

## Phase 1: make the prompt prefix stable enough to cache

**Affected files:**

- `src/agent/system-prompt.ts`
- `src/agent/session-runner.ts`
- possibly `src/session/manager.ts` / `src/session/db/session-repo.ts` if we want a persisted session time anchor

### Change

Replace the current per-turn timestamp in the system prompt with a stable session-level value.

Recommended approach:

- compute a `sessionTimeAnchor` once when the runner/session starts
- pass it into `buildSystemPrompt()`
- render it deterministically, ideally ISO-8601
- do **not** call `new Date().toLocaleString()` on every turn

Why this matters:

- it preserves the user-facing “current date/time” context
- it stops blowing up cache-prefix reuse near the top of the prompt
- it also makes prompts less locale-dependent and easier to test

### Notes

If we want resumed sessions to keep the same anchor, extend `ActiveSession` to carry `created_at` from `SessionRow` and use that. Otherwise, the runner can freeze the anchor at resume time.

## Phase 2: add a cache-settings helper in the LLM layer

**Affected file:** `src/llm-api/providers.ts`

Add a dedicated helper alongside `getThinkingProviderOptions()` that returns cache settings based on the current model family, for example:

- `getCachingProviderOptions(modelString, settings)` for request-level options
- `getCachingMode(modelString)` or equivalent model-family classification

This keeps cache logic close to the existing reasoning-option logic and avoids scattering provider-name checks across `turn.ts`.

Recommended outputs:

- OpenAI / Zen GPT: top-level provider options
- Google / Zen Gemini: top-level provider options
- Anthropic / Zen Claude: classification only; actual message annotation happens in `turn.ts`

## Phase 3: add runtime/user configuration for caching

**Affected files:**

- `src/session/db/settings-repo.ts`
- `src/session/db/index.ts`
- `src/agent/agent.ts`
- `src/agent/session-runner.ts`
- `src/index.ts`
- `src/cli/types.ts`
- `src/cli/commands.ts`

### Suggested config surface

Add a minimal cache configuration, not a large matrix.

Recommended MVP settings:

- `preferred_prompt_caching_enabled` → boolean, default `true`
- `preferred_openai_prompt_cache_retention` → `'in_memory' | '24h'`, default `'in_memory'`
- `preferred_google_cached_content` → string | null, default `null`

I would **not** add Anthropic TTL configuration in v1; default to `ephemeral` and keep the surface small.

### CLI surface

Add a small `/cache` command family, similar to `/context`:

- `/cache` → show current cache settings
- `/cache on|off`
- `/cache openai <in_memory|24h>`
- `/cache gemini <off|cachedContents/...>`

Reason to add command support instead of env-only:

- it matches how model/reasoning/context preferences already work
- settings are already persisted in the SQLite `settings` table: `src/session/db/connection.ts:61-64`

## Phase 4: implement request-level cache options in `runTurn()`

**Affected file:** `src/llm-api/turn.ts`

### Change

Extend the current `mergedProviderOptions` build at `src/llm-api/turn.ts:749-772` to also merge request-level cache provider options.

For OpenAI-family requests:

- set `openai.promptCacheRetention`
- optionally set `openai.promptCacheKey`

For Google-family requests:

- if configured, set `google.cachedContent`

### Prompt cache key strategy

If we add `promptCacheKey`, it should be derived from **stable prefix inputs**, not the full evolving conversation.

Suggested inputs for the key:

- provider/model family
- stable system prompt content
- tool schema signature
- active agent prompt
- local/global context file contents if present

Do **not** include:

- current user turn text
- latest tool results
- volatile timestamps

This key should be deterministic and cheap to compute.

If we want to keep v1 smaller, we can skip `promptCacheKey` initially and only set `promptCacheRetention`.

## Phase 5: implement Anthropic cache breakpoints via message shaping

**Affected file:** `src/llm-api/turn.ts`

This is the most important structural change.

### New helper(s)

Add a helper that takes the already-sanitized/pruned/compacted request state and returns cache-annotated request messages, e.g.:

- `prepareMessagesForCaching(...)`
- `annotateAnthropicCacheBreakpoints(...)`

### Recommended sequence inside `runTurn()`

Current flow is roughly:

1. sanitize / prune / compact messages
2. merge top-level provider options
3. call `streamText()`

New flow should be:

1. sanitize / prune / compact messages
2. compute stable system prompt once
3. annotate message-level Anthropic cache breakpoints on the final request messages
4. merge top-level request-level provider options for OpenAI/Google
5. call `streamText()`

### Anthropic-specific request shape

Recommended v1 policy:

- for Anthropic-family requests, send the system prompt as a **system message inside `messages`** rather than only top-level `system`
- attach `providerOptions.anthropic.cacheControl = { type: 'ephemeral' }` to that system message or its text part
- attach a second breakpoint at the last stable prefix message before the live turn, if the SDK/message shape supports it cleanly

Why this is the right level:

- it matches Anthropic’s message/block-oriented cache model
- it avoids trying to pretend Anthropic works like OpenAI request-level caching
- it keeps the provider-specific branching local to request construction

### Important constraint

Do not mutate persisted conversation history in place just to add request-only cache hints.

Instead:

- derive a request-local `cacheReadyMessages` array from `turnMessages`
- pass that to `streamText()`
- keep persisted history free of request-only annotations unless the SDK itself returns them on model-authored messages

## Phase 6: improve logging so we can verify Zen forwarding behavior

**Affected files:**

- `src/llm-api/turn.ts`
- possibly `src/llm-api/providers.ts`

The repo already logs outbound provider requests via the custom fetch wrapper in `src/llm-api/providers.ts:17-44`.

Add explicit logs before the request for:

- caching enabled/disabled
- cache mode selected by provider family
- OpenAI retention/key presence
- Gemini cachedContent presence
- Anthropic breakpoint count / message indexes

This will make it easy to inspect `~/.config/mini-coder/api.log` and confirm that mini-coder is emitting the intended fields to Zen.

## Detailed implementation steps

1. Stabilize the system prompt timestamp.
   - freeze a session-level time anchor
   - thread it into `buildSystemPrompt()`
   - stop recomputing a live locale timestamp every turn

2. Add settings repo accessors for cache preferences.
   - getter/setter for global on/off
   - getter/setter for OpenAI retention mode
   - getter/setter for optional Gemini cached-content id

3. Thread cache preferences through startup and command context.
   - load them in `src/index.ts`
   - store them on `SessionRunner`
   - expose setters/getters on `CommandContext`

4. Add a small `/cache` command in `src/cli/commands.ts`.
   - show status
   - allow toggling on/off
   - allow setting OpenAI retention
   - allow setting/clearing Gemini cachedContent

5. Add provider-family cache helpers in `src/llm-api/providers.ts`.
   - keep model-family branching centralized
   - mirror the existing reasoning-option style

6. Add request-level cache option merging in `src/llm-api/turn.ts`.
   - merge OpenAI and Google cache options into `mergedProviderOptions`
   - preserve existing reasoning-option merging behavior

7. Add Anthropic message-annotation helpers in `src/llm-api/turn.ts`.
   - build request-local cache-ready messages
   - insert Anthropic cache breakpoints after sanitization/pruning/compaction
   - keep non-Anthropic request construction unchanged

8. Add logging for cache configuration and annotations.

9. Verify via focused tests and `api.log` inspection.

## Tests to add

**Affected files:**

- `src/llm-api/turn.test.ts`
- likely a new focused settings/commands test if command support is added

### Prompt stability tests

- system prompt uses a fixed session anchor instead of a fresh per-turn timestamp
- prompt output is deterministic for the same anchor

### Request-level caching tests

- OpenAI-family model adds `promptCacheRetention` when caching is enabled
- OpenAI-family model does not add cache settings when caching is disabled
- Gemini-family model adds `cachedContent` when configured
- non-Google models ignore Gemini cachedContent settings

### Anthropic message-shaping tests

- Anthropic-family request gets cache annotations on the request-local messages
- non-Anthropic models do not get message-level cache annotations
- persisted `coreHistory` is not mutated by request-only cache shaping
- top-level `system` is not used for Anthropic if we switch that path to system-message form

### Regression tests

- existing Gemini thought-signature behavior remains intact
- existing GPT commentary stripping still works
- existing OpenAI item-id stripping still works
- cache annotations are applied after pruning/compaction, not before

## Risks and caveats

### 1) The biggest practical risk is cache misses from volatile prompt material

Even after fixing the timestamp, cache hit quality still depends on:

- system prompt stability
- active agent prompt changes
- project-context file changes
- tool-set/schema changes
- pruning/compaction decisions changing the replayed prefix

That is normal, but it is another reason to keep the stable prefix as deterministic as possible.

### 2) Anthropic cache-control message shape may require one iteration

The repo already preserves provider metadata well, but Anthropic cache control is the least aligned with our current top-level request construction. I expect the first implementation to need tight unit-test coverage around message shape.

### 3) Gemini full explicit caching should not block phase 1

If we try to also build automatic Gemini cache creation in the same pass, the scope gets much larger. The good boundary is:

- phase 1: consume a configured `cachedContent` id if present
- phase 2: automatic cache creation/refresh lifecycle

## Recommendation on scope

For the first implementation, I recommend this exact scope:

1. **Fix prompt stability first**
2. **Implement OpenAI prompt caching** for Zen GPT models
3. **Implement Anthropic cache breakpoints** for Zen Claude models
4. **Add optional Gemini `cachedContent` pass-through**, but not automatic cache creation
5. **Add minimal CLI/settings support** so the feature can be toggled and inspected

That scope gives real cost-saving potential for your actual flagship-heavy usage without dragging Gemini cache lifecycle management into the first pass.

## Acceptance criteria

- The system prompt no longer contains a fresh per-turn timestamp.
- Zen GPT requests include OpenAI cache settings when caching is enabled.
- Zen Claude requests include Anthropic cache breakpoints on the request message payload.
- Zen Gemini requests can include a configured `cachedContent` id.
- Request-only cache annotations do not mutate persisted conversation history.
- `api.log` clearly shows cache-related request fields being emitted.
- Focused unit tests cover prompt stability, request-level cache options, and Anthropic message shaping.
- Existing turn/history behavior remains green.

## Sources

- OpenAI provider docs: https://sdk.vercel.ai/providers/ai-sdk-providers/openai
- Anthropic provider docs: https://sdk.vercel.ai/providers/ai-sdk-providers/anthropic
- Google Generative AI provider docs: https://sdk.vercel.ai/providers/ai-sdk-providers/google-generative-ai
- AI SDK prompts/provider options docs: https://sdk.vercel.ai/docs/ai-sdk-core/prompts
- AI SDK caching docs: https://sdk.vercel.ai/docs/advanced/caching
