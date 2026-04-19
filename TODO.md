# TODO

Keep this always updated so work can continue across sessions.
Don't keep completed items bloating the file; remove them before committing.
Keep the file structured and minimal.
The spec and code are the sources of truth; this file is just the verified backlog.

## Open issues:

_None._

# Defered issues:

## Theme config plan

- [ ] Extend the existing `settings.json` schema/loader with `theme` overrides and merge them into the active UI theme (`src/settings.ts`, `src/theme.ts`, `src/index.ts`, `spec.md`)
- [ ] Update tests and user-facing docs/help for the `settings.json`-based theme setup (`src/index.test.ts`, `src/ui/help.ts`, `README.md`, `spec.md`)

## Verified UX / behavior debt

- [ ] Prevent `/session` from switching sessions mid-run (`src/ui/commands.ts`, `src/ui/agent.ts`)

## Product backlog

- [ ] Add first-class delegation/subagent support instead of relying on shell-level `mc -p` delegation (`src/agent.ts`, `src/tools.ts`, `src/prompt.ts`, `src/headless.ts`)
