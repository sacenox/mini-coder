# TODO

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

## Gpt 5.4 starts printing garbage:

```
  ← read src/llm-api/turn.test.ts:108+50
    · src/llm-api/turn.test.ts  lines 108–142 of 142
  ✎ replace src/llm-api/turn.test.ts 116:1c–140:39
⠴ replace    ✔ hook post-replace
    ✔ replaced src/llm-api/turn.test.ts
    --- src/llm-api/turn.test.ts
    +++ src/llm-api/turn.test.ts
    @@ -113,11 +113,6 @@
                });
        });

    -   test("leaves non-Gemini models untouched", () => {
    -           const messages = [
    -                   { role: "user", content: "go" },
    -                   {
    -                           role: "assistant",
        test("leaves non-Gemini models untouched", () => {
                const messages: CoreMessage[] = [
                        { role: "user", content: "go" },
  ← read src/llm-api/turn.test.ts:108+40
    · src/llm-api/turn.test.ts  lines 108–137 of 137
◆ to=functions.shell  彩神争霸大发json
{"command":"bun test src/llm-api/turn.test.ts && bun run typecheck","timeout":120000}ո՟иҭanalysis to=functions.shell code
{"command":"bun test src/llm-api/turn.test.ts && bun run typecheck","timeout":120000} frontcompatto=functions.shell  手机上天天中彩票json
{"command":"bun test src/llm-api/turn.test.ts && bun run typecheck","timeout":120000}({
})Oopsto=functions.shell  彩神争霸官方څjson
{"command":"bun test src/llm-api/turn.test.ts && bun run typecheck","timeout":120000}We need ensure JSON only.to=functions.shell  ส่งเงินบาทไทยjson

error: script "dev" exited with code 130
```

## Gpt codex context window maxinng out

I've noticed several sessions with codex spark that error because the context got too big for the model:

```
  ← read node_modules/@ai-sdk/google/src/google-generative-ai-language-model.ts:680+120
    · node_modules/@ai-sdk/google/src/google-generative-ai-language-model.ts  lines 680–799 of 1057  (truncated)
⠙ thinking{
  type: "error",
  sequence_number: 2,
  error: {
    type: "invalid_request_error",
    code: "context_length_exceeded",
    message: "Your input exceeds the context window of this model. Please adjust your input and try again.",
    param: "input",
  },
}
✖ [object Object]
✖ [object Object]
error: script "dev" exited with code 1
```

The same task with GPT 5.4: `ctx 82.8k/1050.0k 8%` used on 82k in context. I know spark is a smaller context, but I'm suprised by how often we max out the 128k context.

## LSP Diagnostics (not very important, with tool-hooks and strong linting, this is not as necessary, but we should implement asap)

We should have a closed loop feedback for LSP diagnostics on edits/reads.

This could potentially be a very big slowdown, waiting for updated diagnostics every edit. This also has bias downsides, stale diagnostics confuse the LLM, and can cause negative distractions.

We need to do research first, but maybe we can leverage the hooks feature to achieve a similar result without the performance penalties? Needs brainstorming

---

## Deferred fixes

- model-info: in `resolveFromProviderRow`, when canonical capability exists but `contextWindow` is null, fall back to provider row context (`capability.contextWindow ?? row.contextWindow`).
- Worktrees share bun lockfile and node_modules. Question this choice, is this really a good idea, or just an opportunity for things to go wrong?
- `subagent-runner.ts`: `Bun.file(proc.stdio[3] as unknown as number).text()` — the double-cast signals a type mismatch. Investigate whether `new Response(proc.stdio[3]).text()` is more correct and whether the current form breaks silently across Bun versions.
