# TODO

Keep this always updated so work can continue across sessions.
Don't keep completed items bloating the file, remove them before committing.
Keep the file structured and minimal.
The spec.md and code are the sources of truth, not this file, don't assume anything because it's documented here.

## In progress

- [ ] **Terminal bench with harbor** in `terminal-bench`.

## Open items

- [ ] **If git is not installed the app breaks** we should check before we use git, and ensure robustness.
- [ ] **Emit a terminal `aborted` event for tool-phase interrupts** (`agent.ts`, `headless.ts`) — interrupting during tool execution currently returns `stopReason: "aborted"` without emitting the terminal `aborted` event required by the headless NDJSON spec.

## Low priority (deffered until further notice)

- [ ] **Prevent `/session` from switching sessions mid-run** (`ui/commands.ts`, `ui/agent.ts`) — selecting a session while a turn is active can desync UI state from the session the loop is still writing to.
- [ ] **Replace custom XML parsing and frontmatter parsing with dedicated dependencies** (`skills.ts`, `prompt.ts`)

## Plugin related (documented only, no plugin related work is planned right now)

- [ ] **Reconcile the plugin tool execution API with the spec/docs** (`plugins.ts`, `index.ts`, `spec.md`) — the implementation currently needs an undocumented `toolHandlers` map in addition to `tools`, so spec-shaped plugin tools can be advertised to the model but still fail at runtime.
- [ ] **Current plugin `AgentContext.messages` is stale** (`index.ts`) — plugin context currently gets a startup snapshot instead of the live current session messages.
- [ ] **Package-name and config-relative plugin imports do not work** (`plugins.ts`) — plugin config says `module` can be a package name or path, but current loading always resolves as a filesystem path from the process CWD.
- [ ] **Prefix plugin tool rendering with `plugin/tool` in the log** (`index.ts`, `ui/conversation.ts`) — generic plugin tool blocks currently show only the bare tool name, so collisions are ambiguous and the UI does not match the spec.

## Future ideas

- [ ] Divider theme plugin — customizable divider animations (scanning pulse, breathing, flowing dots, wave)
- [ ] Backward-compatibility and migration policy for 1.0 (session/app data versioning, explicit migration strategy)
