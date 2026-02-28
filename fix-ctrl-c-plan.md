# Plan: Fix Ctrl+C during agent's turn

## Context
When an agent's turn is interrupted with `Ctrl+C`, the app intercepts the `SIGINT` signal, sets `wasAborted = true`, calls `abortController.abort()`, and removes its per-turn event listener. This part was functioning correctly. 

## The Core Bug
However, when `abortController.abort()` is called, the Vercel AI SDK's `streamText()` function terminates early. The `for await (const chunk of result.fullStream)` loop is interrupted.

The `streamText` result also provides a `result.response` Promise, which resolves when the stream finishes successfully. If the stream is aborted, this Promise **rejects** with an `AbortError`. Because the `for await` loop exits early (either via `break` or throwing an `AbortError`), the `await result.response` line at the bottom of `runTurn()` is never reached.

In Node.js, if a Promise rejects and has no `.catch()` handler attached to it *at the moment of rejection*, it triggers an `unhandledRejection` event. The app's global error handler in `src/cli/output.ts` catches `unhandledRejection`, cleans up the terminal, and throws the error—crashing the app entirely.

## The Fix
To prevent the app from crashing on `Ctrl+C`, we need to attach a no-op `.catch()` handler to `result.response` immediately after calling `streamText()`. This marks the promise rejection as "handled" in Node's eyes, preventing the `unhandledRejection` crash, while still allowing the rest of the graceful cancellation logic to proceed as intended.

```typescript
// src/llm-api/turn.ts
const result = streamText(streamOpts) as StreamTextResultFull;

// If the stream is aborted, result.response will reject with an AbortError.
// If the for-await loop breaks early or throws, result.response is never
// awaited, causing an unhandled rejection that crashes the app.
// We catch it here to mark it as handled (awaiting it later will still throw).
result.response.catch(() => {});
```

This single line guarantees the unhandled rejection will never escape, fulfilling the requirement to elegantly handle Ctrl+C without exiting the app.