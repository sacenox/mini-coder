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

## Audit language to models

I want to improve some aspects of the agents behaviour in mini-coder.

- More responsible token usage. API costs are escalating in 2026 so it's more important than ever to use as little tokens as possible whithout impacting efficiency.
- Evaluate our tools descriptions and wording to make sure they are efficient in token usage and clear to the llm (we see some errors of duplicating code by accident for example).
- Evaluate the output of our tools for token usage considerations.
- Ensure the system prompts are correct and use up to date wording based on context engineering optimization (check online for latest practices, check opencode, codex and oh-my-pi for context)

---

## Write blog posts

- Codex being big dumb and lazy without strong guidance in system prompt/instructions
- Keeping up codebase health when using agents to develop an applications. Avoid regressions, bad tests, lint etc.

---

# Post v1.0.0 work:

## Custom commands vs built-in commands

Let's clean things up:

- `/review` command should use the same code as a custom-commands, consolidate the two. We can create the global `/review` command in `~/.agents/commands` at app start if it doesn't exist. That way it can be a pure custom command and the users are encouraged to edit it for their own custom reviews. Never overwrite the file if it exists. Print a line notifying the user that the command was created.
- Ensure we are correctly implementing commands, skills and agents. Use the claude code and opencode documentation online to audit our implementations, identify gaps and inconsistencies. We should support both of these types of configs, as well as our .agents.
- Now that we have subagents as subprocesses, let's review how it impacted these features.

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
