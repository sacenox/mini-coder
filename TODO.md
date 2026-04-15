# TODO

Keep this always updated so work can continue across sessions.
Don't keep completed items bloating the file, remove them before committing.
Keep the file structured and minimal.
The spec.md and code are the sources of truth, not this file, don't assume anything because it's documented here.

## Open items

- [ ] Git status in prompt text should not change between turns! This breaks caching! Big bug! Spec specifically says it wrong, we should not the edit the system prompt after a session started. Git information should be updated at session start only, never during a session.
- [ ] Headless mode and json output should be separated, without --json headless mode outputs the final response only.
- [ ] Invalid `settings.json` is fatal instead of falling back to no saved settings (`src/settings.ts`)
- [ ] Providers should be readied lazily: on the first message for the selected provider, or for all providers when `/models` is used.

## Forge comparison follow-ups (high-value gaps, highest priority first)

- [ ] Add first-class todo tools plus prompt/UI integration so the agent can track and complete work explicitly instead of relying only on a `/tmp` file (`src/tools.ts`, `src/agent.ts`, `src/prompt.ts`, `src/ui/conversation.ts`)
- [ ] Add loop safeguards: retry policy, tool-failure/request budgets, and doom-loop detection/reminders (`src/agent.ts`, `src/submit.ts`, `src/prompt.ts`)
- [ ] Add dedicated read/search tools so the model relies less on `shell` for code discovery (`src/tools.ts`, `src/prompt.ts`, `src/ui/conversation.ts`)
- [ ] Add first-class delegation/subagent support instead of relying on shell-level `mc -p` delegation (`src/agent.ts`, `src/tools.ts`, `src/prompt.ts`, `src/headless.ts`)

## Low priority (deferred until further notice)

- [ ] Escape-over-overlay behavior is not encoded in app code (`src/ui/commands.ts`, `src/ui.ts`)
- [ ] Custom provider discovery ignores configured `apiKey` (`src/index.ts`)
- [ ] Slash-command autocomplete does not preserve the draft (`src/ui/commands.ts`)
- [ ] `/session` can switch sessions mid-run (`ui/commands.ts`, `ui/agent.ts`)
- [ ] `shell` results are flattened into one text blob (`src/tools.ts`, `src/ui/conversation.ts`)
- [ ] Steering meesages are implemented wrong, they appear in the UI at the end of the turn loop. Not at the next loop interation boundary... NOT CONFIRMED NEEDS DEBUGGING
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
