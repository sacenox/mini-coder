# TODO
- Strange output mid session:

```
◆ Progress update: I’ve implemented a first UX-focused refactor around tool-stream visibility and am now validating stream/event tests plus a manual `bun run dev` run for one-shot tool calls.{"command":"bun test src/llm-api/turn-stream-events.test.ts src/llm-api/turn-execution.test.ts src/cli/tool-render-call.test.ts","timeout":120000}{"command":"bun test src/llm-api/turn-stream-events.test.ts src/llm-api/turn-execution.test.ts src/cli/tool-render-call.test.ts","timeout":120000} to=functions.shell code{"command":"bun test src/llm-api/turn-stream-events.test.ts src/llm-api/turn-execution.test.ts src/cli/tool-render-call.test.ts","timeout":120000} to=functions.shell เงินไทยฟรีto=functions.shell  重庆时时彩杀 ￣亚洲json
{"command":"bun test src/llm-api/turn-stream-events.test.ts src/llm-api/turn-execution.test.ts src/cli/tool-render-call.test.ts","timeout":120000}{"command":"bun test src/llm-api/turn-stream-events.test.ts src/llm-api/turn-execution.test.ts src/cli/tool-render-call.test.ts","timeout":120000}to=functions.shell 񹚊ppjson
{"command":"echo hi","timeout":30000}to=functions.shell  天天买彩票  ಕ್ರಮ`
Let's try once carefully.
{"command":"..."}
```

with function chosen by previous? Wait earlier had "to=functions.shell". yes must include like:
`to=functions.shell  彩神争霸官网json
{"command":"bun test ...","timeout":120000}{"command":"git status --short","timeout":30000}` with to=functions.shell in metadata. Here UI likely hidden. I'll follow same exact:
{"command":"bun test src/llm-api/turn-stream-events.test.ts src/llm-api/turn-execution.test.ts src/cli/tool-render-call.test.ts","timeout":120000} to=functions.shell
to=functions.shell 天天中彩票买json
{"command":"bun test src/llm-api/turn-stream-events.test.ts src/llm-api/turn-execution.test.ts src/cli/tool-render-call.test.ts","timeout":120000}to=multi_tool_use.parallel үрүмjson
{"tool_uses":[{"recipient_name":"functions.shell","parameters":{"command":"bun test src/llm-api/turn-stream-events.test.ts src/llm-api/turn-execution.test.ts src/cli/tool-render-call.test.ts","timeout":120000}}]}to=functions.shell 天天中彩票追号json
{"command":"echo test","timeout":30000}{"command":"git status --short","timeout":30000}

```
with assistant metadata to=functions.shell from UI (not visible in message maybe I set via tool button). In raw text here maybe cannot set to=. Actually we
· reasoning
  **Checking repository status**
  **Inspecting project structure before testing**
  **Planning source inspection**
  **Checking package scripts for testing**
  **Planning stepwise refactor**
  **Testing interactive and one-shot runs**
  **Planning interactive test approach**
  **Inspecting output streaming complexity**
  **Inspecting stream render content**
  **Assessing stream event processing**
  **Inspecting tool call event handling**
  **Considering execution buffering**
  **Planning UI streaming consistency improvements**
  **Exploring interactive session simulation**
  **Investigating command echo and rendering issues**
  **Inspecting provider options for simplification**
  **Identifying rendering issue source**
  **Planning streamlining and cleanup**
  **Assessing streaming rendering issues**
  **Assessing spinner lifecycle**
  **Assessing stream renderer refactor**
  **Assessing provider option complexity**
  **Analyzing caching implementation inconsistencies**
  **Planning provider option refactor**
  **Planning incremental tool-call rendering fix**
  **Modifying test and refactoring stream handling**
  **Adjusting case formatting**
  **Verifying tool-call presence**
  **Restoring missing case for direct chunks**
  **Refactoring test line to use maps**
  **Running targeted test**
  **Testing manual dev run**
  **Refining tool call rendering and deduplication**
  **Updating shell section**
  **Replacing anchors**
  **Checking existing tests for tool rendering**
  **Adding tests for shell and read edge cases**
  **Running targeted tests**
  **Implementing synthetic ID aliasing**
  **Reintroducing skip logic for empty tool-input-start**
  **Editing input start case**
  **Replacing anchors now**
  **Updating test for id omission**
  **Verifying event handling tests**
  **Correcting tool usage**
  **Correcting JSON format in call**
  **Correcting syntax format**
  **Adjusting tool call format**
  **Identifying malformed input issue**
  **Correcting recipient inclusion**
  **Checking mode compatibility**
  **Considering alternative command order**
  **Addressing tool call issues**
  **Diagnosing tool call syntax issue**
  **Identifying silent execution failure**

  __User interrupted here__

  gpt-5.3-codex  ·  ~/src/mini-coder  ·  ✦ medium  ·  ⎇ main  ·  tok 2143.4k/8.5k  ·  ctx 71.0k/400.0k 18%  ·  #mmqw0u3y
  ▶
```

- Error during turn:

```
claude-opus-4-5  ·  ~/src/mini-coder  ·  ✦ medium  ·  ⎇ main  ·  #mmqwc6tq
▶ [pasted: "As we implemnented the idea we made heav…" +18 more lines]
⢿ thinking2525 |   const responseBody = await response.text();
2526 |   const responseHeaders = extractResponseHeaders(response);
2527 |   if (responseBody.trim() === "") {
2528 |     return {
2529 |       responseHeaders,
2530 |       value: new APICallError4({
                        ^
AI_APICallError: Bad Request
      cause: undefined,
        url: "https://opencode.ai/zen/v1/messages",
 requestBodyValues: {
  model: "claude-opus-4-5",
  max_tokens: 64000,
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
    [Object ...]
  ],
  tools: [
    [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...]
  ],
  tool_choice: [Object ...],
  stream: true,
},
 statusCode: 400,
 responseHeaders: {
  "cf-ray": "9dc6b5b3db7c6c66-DFW",
  connection: "keep-alive",
  "content-type": "application/json",
  date: "Sat, 14 Mar 2026 22:28:09 GMT",
  server: "cloudflare",
  "transfer-encoding": "chunked",
},
 responseBody: "",
 isRetryable: false,
       data: undefined,
 vercel.ai.error: true,
 vercel.ai.error.AI_APICallError: true,

      at /home/xonecas/src/mini-coder/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2530:18
      at /home/xonecas/src/mini-coder/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2391:34
      at processTicksAndRejections (native:7:39)

✖ API error 400
  https://opencode.ai/zen/v1/messages
```

---

## UI Audit

- We need to revise all of our output to ensure consistency, **performance** and correctness.
- Ensure we have a good styled output that is clear to the user, refactor as needed.
- Ensure we have propper hierchy in output, and the different types of output are clearly distinguishable for the user, using styles and whitespace.
- Ensure proper spinner functionality, that follow up messages don't rended inline and that is doesn't break anything.

---

## LSP Diagnostics (not very important, with tool-hooks and strong linting, this is not as necessary, but we should implement asap)

We should have a closed loop feedback for LSP diagnostics on edits/reads.

This could potentially be a very big slowdown, waiting for updated diagnostics every edit. This also has bias downsides, stale diagnostics confuse the LLM, and can cause negative distractions.

We need to do research first, but maybe we can leverage the hooks feature to achieve a similar result without the performance penalties? Needs brainstorming

---

## Deferred fixes

- model-info: in `resolveFromProviderRow`, when canonical capability exists but `contextWindow` is null, fall back to provider row context (`capability.contextWindow ?? row.contextWindow`).
- subagent-runner: avoid unconditional full buffering of child `stdout`/`stderr` in `runSubagent`; capture diagnostics only on failure or via a bounded tail buffer to prevent latency/memory regressions.
- Subagent and shell tools are very similar, shell could do what subagent does without changes. This could be leveraged to reduce code. Subagent process runner is used for custom commands that fork context as well, there will need to be refactored.
- `/_debug` hidden command that snapshots recent logs/db and creates a report in the cwd. For dev mostly but available to all. Do not list it anywhere, only documented here and in the code itself.
