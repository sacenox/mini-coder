# TODO

Keep this always updated so work can continue across sessions.
Don't keep completed items bloating the file; remove them before committing.
Keep the file structured and minimal.
The spec and code are the sources of truth; this file is just the verified backlog.

## Open issues:

## MCP + theme config plan

- [ ] Extend the existing `settings.json` schema/loader with `mcp` config, following the same config-file model as `customProviders` (`src/settings.ts`, `src/index.ts`, `spec.md`)
- [ ] Add first-party MCP client support using an official npm package and register the resulting tools from built-in runtime code instead of a plugin layer (`src/index.ts`, `src/tools.ts`, `src/agent.ts`, `spec.md`)
- [ ] Extend the existing `settings.json` schema/loader with `theme` overrides and merge them into the active UI theme (`src/settings.ts`, `src/theme.ts`, `src/index.ts`, `spec.md`)
- [ ] Update tests and user-facing docs/help for the new `settings.json`-based MCP/theme setup and remove plugin references (`src/index.test.ts`, `src/ui/help.ts`, `README.md`, `spec.md`)

## Verified UX / behavior debt

- [ ] Prevent `/session` from switching sessions mid-run (`src/ui/commands.ts`, `src/ui/agent.ts`)
- [ ] Preserve the current slash-command draft when opening command autocomplete instead of clearing the input (`src/ui.ts`, `src/ui/commands.ts`)

## Product backlog

- [ ] Add first-class delegation/subagent support instead of relying on shell-level `mc -p` delegation (`src/agent.ts`, `src/tools.ts`, `src/prompt.ts`, `src/headless.ts`)
