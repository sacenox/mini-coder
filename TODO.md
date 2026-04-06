# TODO

Keep this always updated so work can continue across sessions.
Don't keep completed items bloating the file.
Keep the file structured and minimal.
The spec.md and code are the sources of truth, not this file, don't assume anything because it's documented here.

## Spec alignment

### Core behavior

- [ ] **End-to-end streaming in the UI** (`ui.ts`) — completed assistant/tool messages should remain visible in the conversation log as soon as they happen, without waiting for the full loop to finish and reload from the DB. The current state/event flow drops already-produced assistant text during tool-use turns.

- [ ] **Implement `/skill:name` submission flow** (`ui.ts`) — strip the prefix from input, prepend the selected skill body to the user message, and send the rest of the user text as the instruction.

- [ ] **Implement image submission flow** (`ui.ts`) — when `parseInput()` returns an image, send it as `ImageContent` in the user message when the active model supports images.

- [ ] **Implement file path autocomplete** (`ui.ts`) — `Tab` should autocomplete file paths in normal input mode. When the input starts with `/`, `Tab` should open command selection instead.

- [ ] **Remove the empty-state banner** (`ui.ts`) — spec says no banner/splash screen. The empty conversation view should not show `Ready. Type a message to start.`.

### Robustness

- [ ] **Catch tool handler exceptions in the agent loop** (`agent.ts`) — if a built-in tool or future extension throws, the loop should convert that into an error tool result, still emit `tool_end`, append a `ToolResultMessage`, and continue or fail cleanly instead of crashing the loop.

- [ ] **Fix the `/undo` abort race** (`ui.ts`) — aborting an active run and undoing immediately can still race with the agent loop writing the aborted assistant message. Track the active loop promise and wait for it to settle before removing the last conversational turn.

- [ ] **Surface submit/runtime errors in the TUI** (`ui.ts`) — failures from `submitMessage()` should append a persisted UI message to the conversation log instead of only going to `console.error`.

- [ ] **Harden `readImage` error handling** (`tools.ts`) — catch filesystem read errors after the existence check and return a tool error result instead of throwing.

### Smaller spec mismatches

- [ ] **Implement `Ctrl+Z` suspend/background** (`ui.ts`)
- [ ] **Show shell exit codes in the UI** (`tools.ts`, `ui.ts`) — shell tool rendering should display the numeric exit code.
- [ ] **Left-truncate CWD on narrow terminals** (`ui.ts`) — status bar path should truncate from the left (`…/mini-coder`).
- [ ] **Honor `MC_AGENTS_ROOT=/`** (`index.ts`, `prompt.ts`) — only walk AGENTS.md discovery to filesystem root when this env var is explicitly set.
- [ ] **Fix OAuth credential refresh comparison** (`index.ts`) — avoid reference-based comparison when deciding whether refreshed OAuth credentials should be written back to disk.

## Plugins (deferred until core/spec alignment is done)

- [ ] **Finalize plugin API after core stabilizes** — defer plugin API cleanup until the core behavior is implemented and spec-compliant.
- [ ] **Current plugin `AgentContext.messages` is stale** (`index.ts`) — plugin context currently gets a snapshot instead of the live current session messages.
- [ ] **Package-name plugin imports do not work** (`plugins.ts`) — plugin config says `module` can be a package name or path, but current loading always resolves as a filesystem path.

## Future ideas

- [ ] Session list preview — show first user message snippet in `/session` selector
- [ ] Divider theme plugin — customizable divider animations (scanning pulse, breathing, flowing dots, wave)
- [ ] Backward-compatibility and migration policy for 1.0 (session/app data versioning, explicit migration strategy)
