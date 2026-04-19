# TODO

Keep this always updated so work can continue across sessions.
Don't keep completed items bloating the file; remove them before committing.
Keep the file structured and minimal.
The spec and code are the sources of truth; this file is just the verified backlog.

## Open issues:

- [ ] `/skill:name` is not in help text. It also doesn't appear in the `/` auto complete. It should appear and when selected or userd without `:name` it opens an select overlay with the skills list for the user to select it. Populates the input with the selected skill command: User selects `ui-design` skill, hits enter, the prompt reads `/skill:ui-design` and doesn't submit.
- [ ] Preserve the current slash-command draft when opening command autocomplete instead of clearing the input (`src/ui.ts`, `src/ui/commands.ts`)

# Defered issues:

## Theme config plan

- [ ] Extend the existing `settings.json` schema/loader with `theme` overrides and merge them into the active UI theme (`src/settings.ts`, `src/theme.ts`, `src/index.ts`, `spec.md`)
- [ ] Update tests and user-facing docs/help for the `settings.json`-based theme setup (`src/index.test.ts`, `src/ui/help.ts`, `README.md`, `spec.md`)

## Verified UX / behavior debt

- [ ] Prevent `/session` from switching sessions mid-run (`src/ui/commands.ts`, `src/ui/agent.ts`)

## Product backlog

- [ ] Add first-class delegation/subagent support instead of relying on shell-level `mc -p` delegation (`src/agent.ts`, `src/tools.ts`, `src/prompt.ts`, `src/headless.ts`)
