# Better Errors — Implementation Plan

## Overview

Add structured error logging to file and friendly error parsing for display. Three concerns: (1) log full error details to `~/.config/mini-coder/errors.log`, (2) map known AI SDK errors to terse user-facing messages, (3) wire both into existing error surfaces.

---

## Files to Create

| File | Purpose |
|---|---|
| `src/cli/error-log.ts` | `initErrorLog()`, `logError()` |
| `src/cli/error-parse.ts` | `parseAppError()` |

## Files to Modify

| File | Change |
|---|---|
| `src/index.ts` | Call `initErrorLog()` at startup; use `logError` + `parseAppError` in top-level catch and `main().catch()` |
| `src/cli/output.ts` | Update `renderError(err: unknown)` to call log + parse; update `turn-error` branch in `renderTurn()` |
| `src/agent/agent.ts` | Pass `unknown` to `renderError()` — no logic change needed if signature widens correctly |

---

## Implementation Steps

1. **Create `src/cli/error-log.ts`**
   - Module-level `let writer: ReturnType<ReturnType<typeof Bun.file>['writer']> | null = null`
   - `initErrorLog()`: if `writer` is not null, return early (idempotency). Otherwise resolve path `~/.config/mini-coder/errors.log`, open with `Bun.file(path).writer()` (truncates on open), assign to `writer`. Register `process.on('uncaughtException', (err) => { logError(err, 'uncaught'); process.exit(1) })`.
   - `logError(err: unknown, context?: string)`: if `writer` is null, return. Build log entry string (see Log Format), call `writer.write(entry)`. Keep sync-ish by not awaiting — `write()` on a Bun file writer is buffered; call `writer.flush()` after each write so data lands before a crash.
   - Extract error fields via type-narrowing helpers (not exported): `isObject(err)`, read `.name`, `.message`, `.stack`, `.statusCode`, `.url`, `.isRetryable` defensively.

2. **Create `src/cli/error-parse.ts`**
   - Import AI SDK error classes: `APICallError`, `RetryError`, `NoContentGeneratedError`, `LoadAPIKeyError`, `NoSuchModelError` from `ai`.
   - Export `parseAppError(err: unknown): { headline: string; hint?: string }`.
   - Implement as a chain of `instanceof` checks (see Error Parse Table). For `RetryError`, recurse on `.lastError` and prepend `"Retries exhausted: "` to `headline`.
   - Fallback: extract first non-empty line of `(err as any)?.message ?? String(err)`, no hint.
   - Network check: before the fallback, check if `(err as any)?.code === 'ECONNREFUSED'` or message includes `'ECONNREFUSED'`.

3. **Update `src/cli/output.ts`**
   - Change `renderError` signature from `(msg: string)` to `(err: unknown)`. Inside: call `logError(err, 'render')`, call `parseAppError(err)`, print `✖ red(headline)`, if `hint` print a dim indented hint line (e.g. `  dim(hint)`).
   - In `renderTurn()` `turn-error` branch (non-abort path): replace raw `event.error.message` display with `logError(event.error, 'turn')` then `parseAppError(event.error)` → print `✖ red(headline)`, optional dim hint. Keep the abort quiet-note branch unchanged.
   - All callers of `renderError` that currently pass a string (e.g. in `agent.ts`) — check each call site; if passing a plain string, wrap in `new Error(string)` or let `parseAppError` fallback handle a string gracefully (add string branch at top of `parseAppError`: `if (typeof err === 'string') return { headline: err }`).

4. **Update `src/index.ts`**
   - After `registerTerminalCleanup()` (or equivalent startup call), add `initErrorLog()`.
   - Top-level `catch` around `runAgent()`: replace any raw print with `logError(err, 'agent')` + `parseAppError(err)` → print `✖ red(headline)` + dim hint, then `process.exit(1)`.
   - `main().catch()`: same pattern — `logError(err, 'main')` + parse + print + `process.exit(1)`. Remove bare `console.error(err)`.

5. **Tests (`src/cli/error-parse.test.ts`)**
   - Test `parseAppError` for each mapped error type.
   - Construct real instances where possible (e.g. `new APICallError({ ... })`); check `headline` and `hint` values.
   - Test `RetryError` unwrapping.
   - Test fallback for plain `Error` and plain string.
   - No mocks, no file I/O, no server calls.

---

## Error Parse Table

| Condition | `headline` | `hint` |
|---|---|---|
| `APICallError` with `statusCode === 429` | `"Rate limit hit"` | `"Wait a moment and retry, or switch model with /model"` |
| `APICallError` with `statusCode === 401 \|\| 403` | `"Auth failed"` | `"Check the relevant provider API key env var"` |
| `APICallError` other | `"API error \${statusCode}"` | `url` if present |
| `RetryError` | `"Retries exhausted: \${inner.headline}"` | inner `hint` |
| `NoContentGeneratedError` | `"Model returned empty response"` | `"Try rephrasing or switching model with /model"` |
| `LoadAPIKeyError` | `"API key not found"` | `"Set the relevant provider env var"` |
| `NoSuchModelError` | `"Model not found"` | `"Use /model to pick a valid model"` |
| `code === 'ECONNREFUSED'` or message contains `'ECONNREFUSED'` | `"Connection failed"` | `"Check network or local server"` |
| `string` input | string value | — |
| fallback | first line of `err.message` | — |

> `AbortError` is never passed to `parseAppError` — abort is handled at the call sites before reaching these functions.

---

## Log Format

```
[2026-02-25T22:38:53.123Z] context=turn
  name: APICallError
  message: 429 Too Many Requests
  statusCode: 429
  url: https://api.anthropic.com/v1/messages
  isRetryable: true
  stack: APICallError: 429 Too Many Requests
    at ...
---
```

- Each entry ends with `---\n`.
- Extra fields (`statusCode`, `url`, `isRetryable`) are only emitted if present on the error object.
- Stack is indented two spaces per line.
- File is truncated on each app start (writer opened without append flag).
