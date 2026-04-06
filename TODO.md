# TODO

Keep this always updated so work can continue across sessions.
Don't keep completed items bloating the file.
Keep the file structured and minimal.
The spec.md and code are the sources of truth, not this file, don't assume anything because it's documented here.

## Bugs — from code review

### MUST FIX

- [ ] **Status bar context usage percentage is wrong** (`ui.ts`) — the token usage indicator reports a much higher fraction of the model context window than is actually in use (for example, showing roughly half full when usage is still low). That makes the context meter untrustworthy and could mislead users about when compaction is needed. Fix: audit the percentage calculation and ensure it uses the correct token totals against the active model's real context window.

### High

- [ ] **Uncaught tool handler exceptions** (`agent.ts`) — if a plugin handler (or a built-in on a filesystem error like EPERM) throws, the agent loop crashes. The exception propagates through `submitMessage` (try/finally, no catch) to a `.catch(console.error)` in `handleInput` — invisible in the TUI. The conversation is left inconsistent: `tool_start` emitted but `tool_end` never fires, tool result message never appended. Fix: wrap the `handler()` call in try/catch, produce an error `ToolExecResult`, and always emit `tool_end`.

- [ ] **`/undo` race condition** (`ui.ts`) — `/undo` aborts the agent loop then immediately calls `undoLastTurn`, but `abort()` is asynchronous. The agent loop may still write an `AssistantMessage` (stopReason "aborted") to the same turn after `undoLastTurn` has deleted it, leaving orphaned messages in the DB. Fix: store the agent loop promise as module state; in `handleUndoCommand`, await it (via `.finally()`) before calling `undoLastTurn`.

- [ ] **Invisible submit errors** (`ui.ts`) — `submitMessage` errors only go to `console.error`, invisible in TUI mode. Network errors, malformed responses, or tool handler crashes cause the agent to silently stop. Fix: append a persisted UI message so the error surfaces in the conversation log without leaking into model context.

### Medium

- [ ] **Stale plugin `AgentContext.messages`** (`index.ts`) — `AgentContext.messages` is the same array ref as `state.messages`, which gets reassigned on `/new`, `/session`, `/fork`, `/undo`. Plugins holding the original reference see stale data. Fix: use a getter (`get messages() { return state.messages; }`).

- [ ] **OAuth credential reference comparison** (`index.ts`) — `result.newCredentials !== oauthCredentials[oauthProvider.id]` compares by reference, not value. Causes unnecessary disk writes on every startup if `getOAuthApiKey` returns a new object. Fix: unconditionally assign when result is present, or compare serialized form.

- [ ] **Persisted UI messages create awkward undo/session turn boundaries** (`ui.ts` / `session.ts`) — `/help`, fork notices, and OAuth progress are now correctly persisted in session history, but each UI message currently starts its own turn. That means `/undo` peels off UI log lines one at a time instead of cleanly undoing the last conversational turn, and multi-step flows like OAuth can fragment the history. Fix: decide how UI messages should join turns (e.g. current turn / explicit synthetic turn grouping) and make append sites pass the correct turn consistently.

### Low

- [ ] **`Ctrl+Z` suspend/background** — spec lists it in key bindings but it's not implemented.

- [ ] **Shell output missing exit code** — spec says shell tool rendering should show the command, tool output preview/full output, and exit code. `ToolExecResult` carries `isError` but not the numeric exit code.

- [ ] **CWD truncation on narrow terminals** — spec says truncate from left (`…/mini-coder`). Currently shows the full abbreviated path.

- [ ] **`readImage` missing try/catch** (`tools.ts`) — `executeReadImage` doesn't catch `readFileSync` exceptions. A permission error (EACCES) after the `existsSync` check throws an uncaught exception. Fix: wrap in try/catch, return text error result.

## Polish (deferred until user says so)

- [ ] `/skill:name` input handling (strip prefix, prepend skill body to user message)
- [ ] Sending images in the prompt
- [ ] Tab file path autocomplete in input
- [ ] Context limit compaction (threshold detection, model-generated summary, prompt cache preservation)

## Future ideas

- [ ] Session list preview — show first user message snippet in `/session` selector
- [ ] Divider theme plugin — customizable divider animations (scanning pulse, breathing, flowing dots, wave)
- [ ] Backward-compatibility and migration policy for 1.0 (session/app data versioning, explicit migration strategy)
