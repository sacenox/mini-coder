# TODO

Keep this always update so work can continue accross sessions.
Don't keep completed items bloating the file.
Keep the file strucured and minimal.
The spec.md and code are the sources of truth, not this file, don't assume anything because it's documented here.

## Bugs — from code review

### MUST FIX

- [ ] **TextInput cursor is off by one after line wrapping** (`ui.ts` / cel-tui TextInput integration) — when the input wraps onto a new line, the visual cursor position drifts by one column from the actual insertion point. My current suspicion is that wrapping is happening at the cell level, but the cursor position is being computed against the logical text position without staying in sync with where the wrapped cell actually lands on the next line. That makes editing long prompts confusing and suggests our input layout/measurement does not match how the wrapped text is rendered. Fix: reproduce with a focused UI test and verify the wrapped input width, prompt padding, wrapping semantics, and cursor-position calculation.

- [ ] **Streaming Markdown wraps can corrupt the UI until the turn finishes** (`ui.ts` / cel-tui Markdown integration) — some styled Markdown lines break badly at wrap boundaries during streaming, causing duplicated/corrupted rendering in the conversation log. The corruption clears itself once the assistant turn completes, which suggests a bug in the incremental render path around wrapped styled content rather than persisted message rendering. Fix: reproduce with a regression test and adjust the streaming Markdown/container rendering so wrapped styled lines remain stable while deltas arrive.

- [ ] **Status bar context usage percentage is wrong** (`ui.ts`) — the token usage indicator reports a much higher fraction of the model context window than is actually in use (for example, showing roughly half full when usage is still low). That makes the context meter untrustworthy and could mislead users about when compaction is needed. Fix: audit the percentage calculation and ensure it uses the correct token totals against the active model's real context window.

- [ ] **Conversation log scroll speed is too slow** (`ui.ts`) — scrolling the conversation log appears to move only one line at a time, which makes navigating longer sessions tedious. The scroll step should feel responsive and usable for large transcripts. Fix: audit the wheel/key scroll increment and tune it to scroll by a larger chunk per interaction.

- [ ] **UI theming is broken on non-dark background terminals** This is on us. `cel-tui` explicitly handles the terminal bg and fg; we hardcoded colors without any thought for how the theme feels or looks. Awful work.

### High

- [ ] **Animated turn divider flickers a cursor-shaped artifact at the pulse edge** (`ui.ts`) — while the agent is running, the divider animation shows a flickering cursor-like mark on the right edge of the bright moving segment. So far this was only observed in Alacritty; Ghostty renders the same animation correctly, which suggests a terminal-specific rendering or cursor interaction issue. That makes the busy indicator look glitchy and suggests the animated segment rendering is leaving a stale cell or width mismatch behind as frames advance. Fix: reproduce visually in both terminals, then audit the divider segment widths, cursor visibility/placement, and frame-to-frame rendering so the pulse fully overwrites its previous position.

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

- [ ] User preferences persistence (model, effort) — not in spec, currently resets to defaults on launch
- [ ] Session list preview — show first user message snippet in `/session` selector
- [ ] Divider theme plugin — customizable divider animations (scanning pulse, breathing, flowing dots, wave)
- [ ] Backward-compatibility and migration policy for 1.0 (session/app data versioning, explicit migration strategy)
