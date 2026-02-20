# Fix implementation error

1. The DB only saves text — agent.ts:412–429 strips tool parts before writing to SQLite. That's the right design for persistence, but coreHistory in memory is never trimmed.

- Refactor sessions table to include content, tool call pairs and everything we need to remake
the history on resume. This breaks the schema, this is ok, we generate a new one.
- Ensure we don't break message format expected by the sdks.

Error now when resuling a session:

```sh
mini-coder on  main
→  bun run src/index.ts -c

  mc  mini-coder · v0.1.0
  zen/claude-sonnet-4-6  ·  /home/xonecas/src/mini-coder
  /help for commands  ·  ctrl+d to exit

· Resumed session mlvf9ynv-q7me2 (zen/claude-sonnet-4-6)
· MCP: connected exa
claude-sonnet-4-6  mlvf9ynv  ~/src/mini-coder  ⎇ main
▶ /review
· review — spawning review subagent…

⠸ thinking2452 |       })
2453 |     };
2454 |   } catch (parseError) {
2455 |     return {
2456 |       responseHeaders,
2457 |       value: new APICallError4({
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
  system: [
    [Object ...]
  ],
  messages: [
    [Object ...], [Object ...], [Object ...], [Object ...], [Object ...]
  ],
  tools: [
    [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...], [Object ...]
  ],
  tool_choice: [Object ...],
  stream: true,
},
 statusCode: 400,
 responseHeaders: {
  "cf-ray": "9d113a3adb204276-EWR",
  connection: "keep-alive",
  "content-type": "application/json",
  date: "Fri, 20 Feb 2026 21:51:49 GMT",
  server: "cloudflare",
  "transfer-encoding": "chunked",
},
 responseBody: "{\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"messages: text content blocks must be non-empty\"},\"request_id\":\"req_011CYL4Xuf9LeyiAb6u8ehwk\"}event: ping\ndata: {\"type\":\"ping\",\"cost\":\"0\"}\n\n",
 isRetryable: false,
       data: undefined,
 vercel.ai.error: true,
 vercel.ai.error.AI_APICallError: true,

      at /home/xonecas/src/mini-coder/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2457:18
      at /home/xonecas/src/mini-coder/node_modules/@ai-sdk/provider-utils/dist/index.mjs:2286:34
      at processTicksAndRejections (native:7:39)

✖ Bad Request
```

---

# Undo needs to restore working directory

Besides undoing the conversation turn, it should restore some snapshot, using git?

---

# Tools output

Subagent needs visibity on the ui somehow... that accounts for multiple in parallel... Needs planning, maybe a tree view showing the subagent's tool calls before the output.

---
