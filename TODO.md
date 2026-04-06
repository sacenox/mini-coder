# TODO

## Bugs — from code review

### BREAKING MUST FIX

- [x] **No streaming feel** — fixed in `src/ui.ts` by rendering completed and in-progress assistant content inside stable top-level containers, with regression coverage in `src/ui.test.ts`.
- [ ] **UI Themeing is broken on non-dark background terminals** This is on us, Cel-tui explicit handles the terminal bg and fg, we are just retarded and hardcoded colors, with no tought on what the theme feels or looks like. Aweful work.

### High

- [ ] **Uncaught tool handler exceptions** (`agent.ts`) — if a plugin handler (or a built-in on a filesystem error like EPERM) throws, the agent loop crashes. The exception propagates through `submitMessage` (try/finally, no catch) to a `.catch(console.error)` in `handleInput` — invisible in the TUI. The conversation is left inconsistent: `tool_start` emitted but `tool_end` never fires, tool result message never appended. Fix: wrap the `handler()` call in try/catch, produce an error `ToolExecResult`, and always emit `tool_end`.
- [ ] **`/undo` race condition** (`ui.ts`) — `/undo` aborts the agent loop then immediately calls `undoLastTurn`, but `abort()` is asynchronous. The agent loop may still write an `AssistantMessage` (stopReason "aborted") to the same turn after `undoLastTurn` has deleted it, leaving orphaned messages in the DB. Fix: store the agent loop promise as module state; in `handleUndoCommand`, await it (via `.finally()`) before calling `undoLastTurn`.
- [ ] **Invisible submit errors** (`ui.ts`) — `submitMessage` errors only go to `console.error`, invisible in TUI mode. Network errors, malformed responses, or tool handler crashes cause the agent to silently stop. Fix: replace `console.error` with `appendInfoMessage` so the error surfaces in the conversation log.

### Medium

- [ ] **`readImage` missing try/catch** (`tools.ts`) — `executeReadImage` doesn't catch `readFileSync` exceptions. A permission error (EACCES) after the `existsSync` check throws an uncaught exception. Fix: wrap in try/catch, return text error result.
- [ ] **Fragile `tool_end` matching** (`ui.ts`/`agent.ts`) — `tool_end` events match pending tool calls by name + null resultText. Two calls to the same tool in one response (e.g., two `shell` calls) rely on sequential execution order. Fix: add `toolCallId` to `tool_start`/`tool_end` `AgentEvent` types, emit from `agent.ts`, match by id in `ui.ts`.
- [ ] **Stale plugin `AgentContext.messages`** (`index.ts`) — `AgentContext.messages` is the same array ref as `state.messages`, which gets reassigned on `/new`, `/session`, `/fork`, `/undo`. Plugins holding the original reference see stale data. Fix: use a getter (`get messages() { return state.messages; }`).
- [ ] **OAuth credential reference comparison** (`index.ts`) — `result.newCredentials !== oauthCredentials[oauthProvider.id]` compares by reference, not value. Causes unnecessary disk writes on every startup if `getOAuthApiKey` returns a new object. Fix: unconditionally assign when result is present, or compare serialized form.

### Low (deferred from earlier phases)

- [ ] **Shell output missing exit code** — spec says "Shows the command, head + tail truncated output with a visual marker, and exit code". `ToolExecResult` carries `isError` but not the numeric exit code.
- [ ] **CWD truncation on narrow terminals** — spec says truncate from left (`…/mini-coder`). Currently shows the full abbreviated path.
- [ ] **`Ctrl+Z` suspend/background** — spec lists it in key bindings but it's not implemented.
- [ ] **`/session` delete** — spec says "list, resume, delete" but Select component doesn't expose highlighted item for secondary actions.

## Phase 4d — Polish

- [ ] `/skill:name` input handling (strip prefix, prepend skill body to user message)
- [ ] Image embedding (entire input is image path → embed as `ImageContent`)
- [ ] Conditional `readImage` tool registration (only for vision-capable models, re-evaluated on `/model`)
- [ ] Tab file path autocomplete in input
- [ ] Context limit compaction (threshold detection, model-generated summary, prompt cache preservation)

## Future ideas

- [ ] User preferences persistence (model, effort) — not in spec, currently resets to defaults on launch
- [ ] Session list preview — show first user message snippet in `/session` selector
- [ ] Divider theme plugin — customizable divider animations (scanning pulse, breathing, flowing dots, wave)
