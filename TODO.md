# TODO

- Tool hooks output prints inline with spinner
- Review our markdown renderer. Let's make it render the raw markdown, but syntax highlited
- add a spinner state showing the user when the undo snapshotting is happening
- Structuted output when a skill is auto loaded for the agent

- Kimi-k2.5 and other models that use the same sdk hang for long periods during turns.
- Kimi-k2.5, GLM-5 and other models that use the same sdk produce these errors:

Error 1:

```
"{\"error\":{\"object\":\"error\",\"type\":\"invalid_request_error\",\"code\":\"invalid_request_error\",\"message\":\"Invalid tool call in messages: tool_calls[].function.arguments for function 'read' must decode to a JSON object, got str\"}}",
```

Error 2:

```
2543 |       text: responseBody,
2544 |       schema: errorSchema
2545 |     });
2546 |     return {
2547 |       responseHeaders,
2548 |       value: new APICallError4({
                        ^
AI_APICallError: Expected dict in tool call arguments, got <class 'str'>
      cause: undefined,
        url: "https://opencode.ai/zen/v1/chat/completions",
 requestBodyValues: {
  model: "glm-5",
  user: undefined,
  max_tokens: undefined,
  temperature: undefined,
  top_p: undefined,
  frequency_penalty: undefined,
  presence_penalty: undefined,
  response_format: undefined,
  stop: undefined,
  seed: undefined,
  reasoning_effort: undefined,
  verbosity: undefined,
  messages: [
    [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...]
  ],
  tools: [
    [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...]
  ],
  tool_choice: "auto",
  stream: true,
  stream_options: undefined,
},
 statusCode: 400,
 responseHeaders: {
  "cf-ray": "9dc2e9f38ed09063-BOS",
  connection: "keep-alive",
  "content-type": "application/json",
  date: "Sat, 14 Mar 2026 11:24:46 GMT",
  server: "cloudflare",
  "transfer-encoding": "chunked",
},
 responseBody: "{\n\t\"error\": {\n\t\t\"code\": 400,\n\t\t\"message\": \"Expected dict in tool call arguments, got \\u003cclass 'str'\\u003e\",\n\t\t\"type\": \"Bad Request\"\n\t}\n}\n",
 isRetryable: false,
       data: {
  error: [Object ...],
},
 vercel.ai.error: true,
 vercel.ai.error.AI_APICallError: true,

      at /home/xonecas/src/mini-coder/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2548:18
      at /home/xonecas/src/mini-coder/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2391:34
      at processTicksAndRejections (native:7:39)

✖ API error 400
  https://opencode.ai/zen/v1/chat/completions
```

- Investigate db lock issues with spawning parallel subagents:

```
  ⇢ — Audit scope: CLI/input/output/command behavior against mi…
  ⇢ — Audit scope: tools/core/session/provider/MCP behavior aga…
  ⇢ — Audit scope: repository docs and user-facing documentatio…
    ✖ Subagent subprocess produced no output (exit code 7) (diagnostics: 60 |                   cleanup(); | 61 |                      t)
    ✖ Subagent subprocess produced no output (exit code 7) (diagnostics: 60 |                   cleanup(); | 61 |                      t)
    ⇢ subagent done (882751in / 10514out tokens)
◆ Subagent parallelism hit a SQLite lock in the shared app DB, so I’m finishing the audit with direct reads and a smaller follow-up pass grounded in file references.
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
