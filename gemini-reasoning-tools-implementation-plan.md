# Gemini reasoning + tools fix implementation plan

## Summary

The goal is to fix Gemini reasoning + tool handling so reasoning stays visible to users while tool use continues to work correctly across turns. The current implementation treats Gemini 2.5/3 tool turns as broadly incompatible with reasoning and applies a history sanitizer that can remove valid assistant/tool messages. That is too blunt.

The intended direction is to preserve Gemini thought signatures exactly, stop disabling reasoning for all Gemini tool turns, and narrow recovery logic to cases that are actually invalid. In practice, that means:

- remove blanket reasoning disablement in `src/llm-api/providers.ts`
- rewrite Gemini history sanitization in `src/llm-api/turn.ts` so it validates only truly broken current-turn state
- respect official thought-signature rules, including parallel function-call cases where only the first `functionCall` part carries a signature
- keep full model-generated assistant/tool history intact whenever it is valid, so SDK-managed signature replay keeps working
- retain small, explicit recovery behavior for known integration bugs instead of silently truncating broad spans of history

## Findings

### What the docs and issue reports indicate

- Official Gemini function-calling docs show Gemini 3 supports function calling/tools: https://ai.google.dev/gemini-api/docs/function-calling
- Official thinking docs do not say tool use requires reasoning to be disabled: https://ai.google.dev/gemini-api/docs/thinking
- Official thought-signature docs describe signatures as the key requirement for function calling across turns, and note that official SDKs handle them automatically when full responses are preserved exactly:
  - https://ai.google.dev/gemini-api/docs/thought-signatures
  - https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thought-signatures
- Parallel function calls are valid even when only the first `functionCall` part has a thought signature. So “any tool-call part without `thoughtSignature` means corruption” is not a correct rule.
- Missing signatures do show up in real integrations and SDK bugs, which supports having narrow recovery logic:
  - https://github.com/vercel/ai/issues/10344
  - https://github.com/googleapis/python-genai/issues/2081

### What the repo currently does

- In `src/llm-api/providers.ts`, `shouldDisableGeminiThinkingForTools()` returns `true` for `/^gemini-(2.5|3)/`.
- In the same file, `getThinkingProviderOptions()` returns `null` when `hasTools` is true and the model matches that gate, which disables reasoning for Gemini tool turns.
- In `src/llm-api/turn.ts`, `sanitizeGeminiToolMessages()` only runs for models gated by `shouldDisableGeminiThinkingForTools()`.
- `assistantMessageHasUnsignedGeminiToolCall()` marks any tool-call part without `thoughtSignature` as broken.
- The sanitizer then truncates history back to the next user turn, or slices history at the broken point if there is no later user turn.

## Verdict

Disabling reasoning for all Gemini 2.5/3 tool turns is not a correct general fix. The official docs support Gemini tools with thinking, and they point to exact preservation of thought signatures rather than reasoning disablement as the compatibility requirement.

The current sanitizer is also too aggressive. It assumes any unsigned tool-call part is corrupted, which is false for valid parallel-call responses. Because of that, it can delete healthy history and reduce model quality by removing assistant/tool state that should have been replayed unchanged.

The right fix is to preserve and replay Gemini thought-signature-bearing content exactly, and only repair or drop history when there is strong evidence that the most recent tool turn is malformed in a way the provider will reject.

## Proposed code changes

### 1) Remove blanket Gemini reasoning disablement

**Affected file:** `src/llm-api/providers.ts`

Change `getThinkingProviderOptions()` so Gemini thinking options are still returned when tools are present. The simplest version is to remove the `hasTools && shouldDisableGeminiThinkingForTools(modelString)` early return entirely.

Follow-up cleanup:

- remove `GEMINI_TOOL_CALL_AFFECTED_MODELS` and `shouldDisableGeminiThinkingForTools()` if they are no longer needed
- or, if a model-specific workaround flag is still wanted, rename and repurpose it for narrow recovery behavior rather than provider-option suppression

Expected behavior after change:

- Gemini 2.5/3 tool turns can request thinking normally
- reasoning remains visible during the turn
- provider options are not silently stripped just because tools are enabled

### 2) Rewrite Gemini sanitizer around actual invalidity rules

**Affected file:** `src/llm-api/turn.ts`

Replace the current `assistantMessageHasUnsignedGeminiToolCall()` heuristic with validation that reflects thought-signature semantics.

Suggested behavior:

- keep `normalizeMessageProviderOptions()` and `getPartProviderOptions()` as shared helpers
- add a helper that inspects a single assistant message and classifies Gemini tool-call structure, for example:
  - no tool calls
  - valid signed single-call turn
  - valid parallel-call turn where the first tool-call part has a signature and later sibling tool-call parts may not
  - invalid turn with tool calls but no signature anchor where one is required
- treat a tool-call assistant message as valid if at least one eligible tool-call part in that assistant response carries a thought signature and unsigned sibling calls follow within the same assistant message
- continue to accept legacy `providerMetadata` as an input alias, but preserve/export the effective data in `providerOptions`

The sanitizer should only recover from truly invalid history, and only in the smallest safe scope.

Recommended scope rule:

- inspect only the most recent unresolved Gemini tool interaction, not arbitrary older turns
- if the latest assistant tool-call message is invalid, drop only the incomplete current-turn suffix starting at that assistant message, plus any following tool/result messages tied to it
- do not delete earlier valid turns just because a later integration bug produced malformed state
- do not truncate to the next user turn as a default recovery strategy

This should turn the sanitizer from a broad history-pruning mechanism into a narrow “repair broken current turn if necessary” step.

### 3) Preserve thought signatures exactly in persisted and replayed messages

**Affected files:**

- `src/llm-api/turn.ts`
- `src/agent/session-runner.ts`
- `src/session/db/message-repo.ts`

The repo already accumulates `step.response.messages` / `step.messages` and persists `newMessages`. The implementation should explicitly verify that no transformation strips or rewrites Gemini signature-bearing provider metadata on assistant tool-call parts before those messages are stored and replayed.

Concrete expectations:

- preserve assistant message part ordering exactly
- preserve `providerOptions.google.thoughtSignature` and `providerOptions.vertex.thoughtSignature` byte-for-byte
- do not reconstitute tool-call messages from streamed events for persistence if authoritative step messages already exist
- avoid any compaction or sanitization pass that mutates valid assistant tool-call parts

If a normalization step copies `providerMetadata` to `providerOptions`, it should be additive and lossless, not a rewrite that changes valid signature payloads.

### 4) Improve observability for narrow recovery cases

**Affected file:** `src/llm-api/turn.ts`

Replace the current `"gemini tool history truncated"` logging with more specific diagnostics, for example:

- `gemini tool history repaired`
- reason: `missing-signature-anchor`, `malformed-tool-call-part`, `orphaned-tool-result-after-repair`, etc.
- repairedFromIndex / droppedMessageCount
- whether the affected scope was only the current unresolved turn

This makes rollout safer and gives evidence if the remaining recovery path is still firing often.

## Detailed implementation steps

1. Update `src/llm-api/providers.ts`:
   - remove the early return that disables thinking when `hasTools` is true for Gemini models
   - delete or deprecate `shouldDisableGeminiThinkingForTools()` and update imports/tests accordingly

2. Refactor Gemini validation helpers in `src/llm-api/turn.ts`:
   - keep signature extraction helper support for both `providerOptions` and `providerMetadata`
   - replace `assistantMessageHasUnsignedGeminiToolCall()` with a helper that evaluates an assistant message as a whole, not part-by-part in isolation
   - encode the parallel-call rule explicitly: one signature can cover a multi-call assistant response

3. Rewrite `sanitizeGeminiToolMessages()`:
   - run for Gemini tool histories based on provider/model family, not on the old “disable thinking” gate
   - scan backward from the tail to find the latest assistant tool-call message and any following related tool messages
   - if that tail segment is valid, return messages unchanged
   - if invalid, remove only that tail segment and keep earlier history intact
   - never remove valid earlier turns just because an older assistant message had unsigned sibling tool-call parts

4. Verify persistence path:
   - confirm `partialState.messages` from `onStepFinish` remain the source of truth
   - confirm stored/replayed messages include the original assistant content parts with thought signatures unchanged
   - add comments near the persistence path explaining that full Gemini responses must be preserved exactly for signature replay correctness

5. Update logging and comments to document the new invariant:
   - reasoning is allowed with Gemini tools
   - history repair exists only for malformed tail state caused by integration issues

## Tests to add or update

**Affected files:** `src/llm-api/providers.test.ts`, `src/llm-api/turn.test.ts`

### Providers tests

- remove tests that assert Gemini 2.5/3 tool turns disable reasoning
- add tests asserting `getThinkingProviderOptions()` still returns Gemini thinking options when `hasTools` is true
- if `shouldDisableGeminiThinkingForTools()` is removed, delete its test block; if retained as a narrower flag, rewrite tests to match its new semantics

### Turn tests

Replace current sanitizer expectations with cases that reflect valid signature behavior:

- valid single Gemini tool call with signature is preserved unchanged
- valid parallel Gemini tool calls where only the first tool-call part has a signature are preserved unchanged
- legacy `providerMetadata` signatures are still recognized and normalized losslessly
- malformed latest Gemini tool-call turn with no signature anchor is repaired by dropping only the tail segment
- earlier valid turns remain intact when the latest turn is repaired
- non-Gemini models are unaffected
- sanitizer is a no-op when there are no Gemini tool-call assistant messages

Optional but useful:

- regression test proving sanitizer no longer deletes history up to the next user turn
- regression test proving exact `thoughtSignature` values survive round-trip storage/replay assumptions at the `CoreMessage` level

## Rollout and risk notes

- Main product risk: re-enabling reasoning for Gemini tools could expose any remaining SDK/provider incompatibilities that the blanket workaround used to hide.
- Main quality risk: if tail repair is too permissive, malformed history could still be replayed and trigger provider errors.
- Mitigation: keep recovery narrow, instrument it well, and verify with focused tests around single-call and parallel-call histories.
- Because the change is localized to provider options and history sanitation, it should be low-risk for non-Gemini providers.

## Open questions and assumptions

- Assumption: preserving the SDK-authored `step.response.messages` / `step.messages` is sufficient for correct thought-signature replay in this codebase.
- Assumption: Gemini invalid-history failures are primarily tail-state problems from integration bugs, not arbitrary deep-history corruption.
- Open question: should repair logic also validate matching tool-result coverage for repaired tails, or only signature anchoring on assistant tool-call messages?
- Open question: do any current upstream adapters place the signature anywhere other than `providerOptions.google|vertex.thoughtSignature` or legacy `providerMetadata`? If yes, add a compatibility helper rather than weakening validation globally.

## Acceptance criteria

- Gemini tool turns can use thinking without `getThinkingProviderOptions()` returning `null` solely because tools are present.
- Reasoning remains visible during Gemini tool turns.
- Valid Gemini tool-call histories, including parallel calls with only the first call signed, are preserved unchanged.
- Thought signatures are persisted and replayed exactly on assistant tool-call parts.
- Recovery logic only trims truly invalid current-tail Gemini history and never broad-truncates healthy earlier turns.
- Updated unit tests cover the new rules and pass.
- Existing non-Gemini behavior remains unchanged.

## Sources

- https://ai.google.dev/gemini-api/docs/function-calling
- https://ai.google.dev/gemini-api/docs/thinking
- https://ai.google.dev/gemini-api/docs/thought-signatures
- https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thought-signatures
- https://github.com/vercel/ai/issues/10344
- https://github.com/googleapis/python-genai/issues/2081
