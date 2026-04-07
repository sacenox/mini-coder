# TODO

Keep this always updated so work can continue across sessions.
Don't keep completed items bloating the file.
Keep the file structured and minimal.
The spec.md and code are the sources of truth, not this file, don't assume anything because it's documented here.

## Spec alignment

### Prompt and session context

- [ ] **Reload AGENTS.md, skills, and plugins on `/new`** (`index.ts`, `ui/commands.ts`) — they are only loaded at startup right now, but the spec says prompt context can change on `/new` or CWD change.
- [ ] **Honor `MC_AGENTS_ROOT=/`** (`index.ts`, `prompt.ts`) — only walk AGENTS.md discovery to filesystem root when this env var is explicitly set.
- [ ] **Fix OAuth credential refresh comparison** (`index.ts`) — avoid reference-based comparison when deciding whether refreshed OAuth credentials should be written back to disk.

### UI mismatches

- [ ] **Implement `Ctrl+Z` suspend/background** (`ui.ts`)
- [ ] **Show shell exit codes in the UI** (`tools.ts`, `ui.ts`) — shell tool rendering should display the numeric exit code.
- [ ] **Render a real diff for new-file `edit` results** (`ui/conversation.ts`) — the spec calls for a unified diff, but the current UI only shows `(new file)`.
- [ ] **Left-truncate CWD on narrow terminals** (`ui.ts`) — status bar path should truncate from the left (`…/mini-coder`).

## Plugins and API drift (deferred until core/spec alignment is done)

- [ ] **Reconcile the plugin tool execution API with the spec/docs** (`plugins.ts`, `index.ts`, `spec.md`) — the implementation currently needs an undocumented `toolHandlers` map in addition to `tools`, so plugin tools are not actually self-describing the way the spec says.
- [ ] **Current plugin `AgentContext.messages` is stale** (`index.ts`) — plugin context currently gets a startup snapshot instead of the live current session messages.
- [ ] **Package-name plugin imports do not work** (`plugins.ts`) — plugin config says `module` can be a package name or path, but current loading always resolves as a filesystem path.

## Future ideas

- [ ] Headless one-shot CLI mode for non-interactive runs and benchmark harnesses like Harbor/Terminal-Bench (https://www.tbench.ai/)
- [ ] Colocate extracted UI module tests under `src/ui/` (`agent.test.ts`, `commands.test.ts`, etc.) instead of keeping them at `src/ui.*.test.ts`
- [ ] Session list preview — show first user message snippet in `/session` selector
- [ ] Use dark/cold to warm/bright gradient for the statusbar backgrounds, the model info based on the thinking effort, and the session stats based on context percentage.
- [ ] Divider theme plugin — customizable divider animations (scanning pulse, breathing, flowing dots, wave)
- [ ] Backward-compatibility and migration policy for 1.0 (session/app data versioning, explicit migration strategy)
