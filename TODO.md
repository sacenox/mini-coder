# TODO

## Investigate error:

```
◆ Now add `renderSubagentStart` and `renderSubagentResult` exports, and remove the subagent no-ops from `renderToolResultInline` and `renderToolResult`. Let me find these:
  ← read src/cli/tool-render.ts:90+15
    · src/cli/tool-render.ts  lines 90–104 of 571  (truncated)
◆ Now find the subagent no-op in `renderToolResultInline`:
  ← read
    ✖ Invalid input for tool read: JSON parsing failed: Text: {"path": "src/cli/tool-render.ts", "line"": 210, "count": 20}.
⠹ thinking2522 |   const responseBody = await response.text();
2523 |   const responseHeaders = extractResponseHeaders(response);
2524 |   if (responseBody.trim() === "") {
2525 |     return {
2526 |       responseHeaders,
2527 |       value: new APICallError4({
                        ^
AI_APICallError: Bad Request
      cause: undefined,
        url: "https://opencode.ai/zen/v1/messages",
 requestBodyValues: {
  model: "claude-sonnet-4-6",
  max_tokens: 128000,
  temperature: undefined,
  top_k: undefined,
  top_p: undefined,
  stop_sequences: undefined,
  thinking: [Object ...],
  output_config: [Object ...],
  system: [
    [Object ...]
  ],
  messages: [
    [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...],
    [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...],
    ... 35 more items
  ],
  tools: [
    [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...]
  ],
  tool_choice: [Object ...],
  stream: true,
},
 statusCode: 400,
 responseHeaders: {
  "cf-ray": "9da4778aca7960ae-ORD",
  connection: "keep-alive",
  "content-type": "application/json",
  date: "Tue, 10 Mar 2026 18:43:47 GMT",
  server: "cloudflare",
  "transfer-encoding": "chunked",
},
 responseBody: "",
 isRetryable: false,
       data: undefined,
 vercel.ai.error: true,
 vercel.ai.error.AI_APICallError: true,

      at /home/xonecas/src/mini-coder/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2527:18
      at /home/xonecas/src/mini-coder/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2388:34
      at processTicksAndRejections (native:7:39)

✖ API error 400
  https://opencode.ai/zen/v1/messages
✖ API error 400
  https://opencode.ai/zen/v1/messages
error: script "dev" exited with code 1
```

---

## LSP Diagnostics (not very important, with tool-hooks and strong linting, this is not as necessary, but we should implement asap)

We should have a closed loop feedback for LSP diagnostics on edits/reads.

This could potentially be a very big slowdown, waiting for updated diagnostics every edit. This also has bias downsides, stale diagnostics confuse the LLM, and can cause negative distractions.

We need to do research first, but maybe we can leverage the hooks feature to achieve a similar result without the performance penalties? Needs brainstorming

---

## Deferred fixes

- model-info: in `resolveFromProviderRow`, when canonical capability exists but `contextWindow` is null, fall back to provider row context (`capability.contextWindow ?? row.contextWindow`).
- Worktrees share bun lockfile and node_modules. Question this choice, is this really a good idea, or just an opportunity for things to go wrong?
- `subagent-runner.ts`: `Bun.file(proc.stdio[3] as unknown as number).text()` — the double-cast signals a type mismatch. Investigate whether `new Response(proc.stdio[3]).text()` is more correct and whether the current form breaks silently across Bun versions.
