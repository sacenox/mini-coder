# TODO

Keep this always updated so work can continue across sessions.
Don't keep completed items bloating the file.
Keep the file structured and minimal.
The spec.md and code are the sources of truth, not this file, don't assume anything because it's documented here.

## Spec alignment

### Robustness

- [ ] **Fix turn-end streaming/render mismatch** (`ui.ts`) — the streamed `Thinking... N lines.` placeholder disappears at turn end and the UI flashes because the in-progress render path does not match the final committed render. Debug the split-brain rendering and make turn completion visually stable.

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

- [ ] Demo asset tooling — script README preview GIF/poster generation from terminal recordings instead of relying on ad hoc `ffmpeg` commands
- [ ] Session list preview — show first user message snippet in `/session` selector
- [ ] Divider theme plugin — customizable divider animations (scanning pulse, breathing, flowing dots, wave)
- [ ] Backward-compatibility and migration policy for 1.0 (session/app data versioning, explicit migration strategy)
