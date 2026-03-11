# TODO

## Models missing from /models list

I can't see `gpt-5.4` anymore, but it's still listed on their site, and opencode still works with it using the same provider:

```
▶ /models

  zen
    · big-pickle free 200k
      zen/big-pickle
    · claude-3-5-haiku 200k
      zen/claude-3-5-haiku
    · claude-haiku-4-5 200k
      zen/claude-haiku-4-5
    · claude-opus-4-1 200k
      zen/claude-opus-4-1
    · claude-opus-4-5 200k
      zen/claude-opus-4-5
    · claude-opus-4-6 1000k
      zen/claude-opus-4-6
    · claude-sonnet-4 1000k
      zen/claude-sonnet-4
    · claude-sonnet-4-5 1000k
      zen/claude-sonnet-4-5
    · claude-sonnet-4-6 1000k
      zen/claude-sonnet-4-6
    · gemini-3-flash 1049k
      zen/gemini-3-flash
    · gemini-3-pro 1049k
      zen/gemini-3-pro
    · gemini-3.1-pro 1049k ◀ ✦ medium
      zen/gemini-3.1-pro
    · glm-4.6 205k
      zen/glm-4.6
    · glm-4.7 205k
      zen/glm-4.7
    · glm-5 205k
      zen/glm-5
    · gpt-5 400k
      zen/gpt-5
    · gpt-5-codex 400k
      zen/gpt-5-codex
    · gpt-5-nano free 400k
      zen/gpt-5-nano
    · gpt-5.1 400k
      zen/gpt-5.1
    · gpt-5.1-codex 400k
      zen/gpt-5.1-codex
    · gpt-5.1-codex-max 400k
      zen/gpt-5.1-codex-max
    · gpt-5.1-codex-mini 400k
      zen/gpt-5.1-codex-mini
    · gpt-5.2 400k
      zen/gpt-5.2
    · gpt-5.2-codex 400k
      zen/gpt-5.2-codex
    · gpt-5.3-codex 400k
      zen/gpt-5.3-codex
    · kimi-k2 128k
      zen/kimi-k2
    · kimi-k2-thinking 262k
      zen/kimi-k2-thinking
    · kimi-k2.5 262k
      zen/kimi-k2.5
    · minimax-m2.1 205k
      zen/minimax-m2.1
    · minimax-m2.5 205k
      zen/minimax-m2.5
    · minimax-m2.5-free free 205k
      zen/minimax-m2.5-free
    · trinity-large-preview-free free 131k
      zen/trinity-large-preview-free
```

## Investigate broken api with Gemini:

```
⠴ thinking2438 |       text: responseBody,
2439 |       schema: errorSchema
2440 |     });
2441 |     return {
2442 |       responseHeaders,
2443 |       value: new APICallError4({
                        ^
AI_APICallError: Unable to submit request because function call `default_api:replace` in the 26. content block is missing a `thought_signature`. Learn more: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thought-signatures
      cause: undefined,
        url: "https://opencode.ai/zen/v1/models/gemini-3.1-pro:streamGenerateContent?alt=sse",
 requestBodyValues: {
  generationConfig: [Object ...],
  contents: [
    [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...]
  ],
  systemInstruction: [Object ...],
  safetySettings: undefined,
  tools: [
    [Object ...]
  ],
  toolConfig: [Object ...],
  cachedContent: undefined,
  labels: undefined,
},
 statusCode: 400,
 responseHeaders: {
  "cf-ray": "9da99240986c1124-ORD",
  connection: "keep-alive",
  "content-type": "text/event-stream",
  date: "Wed, 11 Mar 2026 09:35:55 GMT",
  server: "cloudflare",
  "transfer-encoding": "chunked",
},
 responseBody: "{\n  \"error\": {\n    \"code\": 400,\n    \"message\": \"Unable to submit request because function call `default_api:replace` in the 26. content block is missing a `thought_signature`. Learn more: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thought-signatures\",\n    \"status\": \"INVALID_ARGUMENT\"\n  }\n}\n",
 isRetryable: false,
       data: {
  error: [Object ...],
},
 vercel.ai.error: true,
 vercel.ai.error.AI_APICallError: true,

      at /Users/seancaetanomartin/src/mini-coder/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2443:18
      at /Users/seancaetanomartin/src/mini-coder/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2286:34
      at processTicksAndRejections (native:7:39)

✖ API error 400
  https://opencode.ai/zen/v1/models/gemini-3.1-pro:streamGenerateContent?alt=sse
✖ API error 400
  https://opencode.ai/zen/v1/models/gemini-3.1-pro:streamGenerateContent?alt=sse
```

## LSP Diagnostics (not very important, with tool-hooks and strong linting, this is not as necessary, but we should implement asap)

We should have a closed loop feedback for LSP diagnostics on edits/reads.

This could potentially be a very big slowdown, waiting for updated diagnostics every edit. This also has bias downsides, stale diagnostics confuse the LLM, and can cause negative distractions.

We need to do research first, but maybe we can leverage the hooks feature to achieve a similar result without the performance penalties? Needs brainstorming

---

## Deferred fixes

- model-info: in `resolveFromProviderRow`, when canonical capability exists but `contextWindow` is null, fall back to provider row context (`capability.contextWindow ?? row.contextWindow`).
- Worktrees share bun lockfile and node_modules. Question this choice, is this really a good idea, or just an opportunity for things to go wrong?
- `subagent-runner.ts`: `Bun.file(proc.stdio[3] as unknown as number).text()` — the double-cast signals a type mismatch. Investigate whether `new Response(proc.stdio[3]).text()` is more correct and whether the current form breaks silently across Bun versions.
