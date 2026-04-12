# TODO

Keep this always updated so work can continue across sessions.
Don't keep completed items bloating the file, remove them before committing.
Keep the file structured and minimal.
The spec.md and code are the sources of truth, not this file, don't assume anything because it's documented here.

## Open items

## Low priority (deffered until further notice)

- [ ] **Many `mc` instances on the same host can cause SQL Busy errors** - Doesn't happen often but I've seen it happen with many mc instances open, which makes sense. We should investigate what we can do to add robustness at the SQL layer.
- [ ] **Prevent `/session` from switching sessions mid-run** (`ui/commands.ts`, `ui/agent.ts`) — selecting a session while a turn is active can desync UI state from the session the loop is still writing to.
- [ ] **Replace custom XML parsing and frontmatter parsing with dedicated dependencies** (`skills.ts`, `prompt.ts`)

## Plugin related (documented only, no plugin related work is planned right now)

- [ ] **Reconcile the plugin tool execution API with the spec/docs** (`plugins.ts`, `index.ts`, `spec.md`) — the implementation currently needs an undocumented `toolHandlers` map in addition to `tools`, so spec-shaped plugin tools can be advertised to the model but still fail at runtime.
- [ ] **Current plugin `AgentContext.messages` is stale** (`index.ts`) — plugin context currently gets a startup snapshot instead of the live current session messages.
- [ ] **Package-name and config-relative plugin imports do not work** (`plugins.ts`) — plugin config says `module` can be a package name or path, but current loading always resolves as a filesystem path from the process CWD.
- [ ] **Prefix plugin tool rendering with `plugin/tool` in the log** (`index.ts`, `ui/conversation.ts`) — generic plugin tool blocks currently show only the bare tool name, so collisions are ambiguous and the UI does not match the spec.

## Future ideas

- [ ] cel-tui now supports setting the terminal title text. We should use this to show activity and session information to the user: "Preview of last assistant/user message... - <animation if turn is in flight in sync with divider animation>". Use a simple animation, like a repeating elipsis. we just need to make sure that if the divider is on, the window title is too, they can't be out of sync, that would be confusing.
- [ ] Divider theme plugin — customizable divider animations (scanning pulse, breathing, flowing dots, wave)
- [ ] Backward-compatibility and migration policy for 1.0 (session/app data versioning, explicit migration strategy)
