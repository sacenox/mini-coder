# TODO

Keep this always updated so work can continue across sessions.
Don't keep completed items bloating the file, remove them before committing.
Keep the file structured and minimal.
The spec.md and code are the sources of truth, not this file, don't assume anything because it's documented here.

## Open items

- [ ] `shell` results are flattened into one text blob (`src/tools.ts`, `src/ui/conversation.ts`)
- [ ] Invalid `settings.json` is fatal instead of falling back to no saved settings (`src/settings.ts`)
- [ ] Escape-over-overlay behavior is not encoded in app code (`src/ui/commands.ts`, `src/ui.ts`)
- [ ] Custom provider discovery ignores configured `apiKey` (`src/index.ts`)

## Low priority (deferred until further notice)

- [ ] Slash-command autocomplete does not preserve the draft (`src/ui/commands.ts`)
- [ ] Many `mc` instances on the same host can cause SQL Busy errors
- [ ] `/session` can switch sessions mid-run (`ui/commands.ts`, `ui/agent.ts`)
- [ ] Custom XML parsing and frontmatter parsing are still in use (`skills.ts`, `prompt.ts`)

## Plugin related (documented only, no plugin-related work is planned right now)

- [ ] Plugin tool execution API does not match the spec/docs (`plugins.ts`, `index.ts`, `spec.md`)
- [ ] Plugin `AgentContext.messages` is stale (`index.ts`)
- [ ] Package-name and config-relative plugin imports do not work (`plugins.ts`)
- [ ] Plugin tool rendering is not prefixed with `plugin/tool` in the log (`index.ts`, `ui/conversation.ts`)

## Future ideas

- [ ] Terminal title should show activity/session info and stay in sync with the divider animation
- [ ] Divider theme plugin — customizable divider animations (scanning pulse, breathing, flowing dots, wave)
- [ ] Backward-compatibility and migration policy for 1.0 (session/app data versioning, explicit migration strategy)
