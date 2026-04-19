# TODO

Keep this always updated so work can continue across sessions.
Don't keep completed items bloating the file; remove them before committing.
Keep the file structured and minimal.
The spec and code are the sources of truth; this file is just the verified backlog.

## Open issues:

## Verified UX / behavior debt

- [ ] Prevent `/session` from switching sessions mid-run (`src/ui/commands.ts`, `src/ui/agent.ts`)
- [ ] Preserve the current slash-command draft when opening command autocomplete instead of clearing the input (`src/ui.ts`, `src/ui/commands.ts`)

## Product backlog

- [ ] Add first-class delegation/subagent support instead of relying on shell-level `mc -p` delegation (`src/agent.ts`, `src/tools.ts`, `src/prompt.ts`, `src/headless.ts`)

## Plugin debt (verified, deferred)

> We should have built the code plugin first, now we are a little bit in a corner. The only clear seam is core/UI.

- [ ] Make plugin lifecycle match the spec: initialize once at startup and destroy on shutdown, not on prompt-context reload boundaries (`src/index.ts`, `src/plugins.ts`)
- [ ] Match the plugin tool execution API to the spec/docs instead of the temporary `tools` + `toolHandlers` split (`src/plugins.ts`, `src/index.ts`, `spec.md`)
- [ ] Keep `Plugin AgentContext.messages` current or narrow the contract so it is not stale (`src/index.ts`, `src/plugins.ts`, `spec.md`)
- [ ] Support package-name and config-relative plugin imports (`src/plugins.ts`)
- [ ] Prefix plugin tool rendering with `plugin/tool` in the log when available (`src/index.ts`, `src/ui/conversation.ts`)
