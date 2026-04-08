# TODO

Keep this always updated so work can continue across sessions.
Don't keep completed items bloating the file.
Keep the file structured and minimal.
The spec.md and code are the sources of truth, not this file, don't assume anything because it's documented here.

## Plugins and API drift (deferred until core/spec alignment is done)

- [ ] **Reconcile the plugin tool execution API with the spec/docs** (`plugins.ts`, `index.ts`, `spec.md`) — the implementation currently needs an undocumented `toolHandlers` map in addition to `tools`, so plugin tools are not actually self-describing the way the spec says.
- [ ] **Current plugin `AgentContext.messages` is stale** (`index.ts`) — plugin context currently gets a startup snapshot instead of the live current session messages.
- [ ] **Package-name plugin imports do not work** (`plugins.ts`) — plugin config says `module` can be a package name or path, but current loading always resolves as a filesystem path.

## Future ideas

- [ ] Headless one-shot CLI mode for non-interactive runs and benchmark harnesses like Harbor/Terminal-Bench (https://www.tbench.ai/)
- [ ] Session list preview — show first user message snippet in `/session` selector
- [ ] Use dark/cold to warm/bright gradient for the statusbar backgrounds, the model info based on the thinking effort, and the session stats based on context percentage.
- [ ] Divider theme plugin — customizable divider animations (scanning pulse, breathing, flowing dots, wave)
- [ ] Backward-compatibility and migration policy for 1.0 (session/app data versioning, explicit migration strategy)
