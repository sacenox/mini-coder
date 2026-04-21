# TODO

Keep this always updated so work can continue across sessions.
Don't keep completed items bloating the file; remove them before committing.
Keep the file structured and minimal.
The spec and code are the sources of truth; this file is just the verified backlog.

## Open issues:

- [ ] Read tool output should include line numbers to help the llm find it's anchors.
- [ ] If an agent uses readImage on a non-image file, mc crashes
- [ ] If a conversation is truncated away from the db when the UI is still open somewhere, the app crashes.
- [ ] Prevent `/session` from switching sessions mid-run (`src/ui/commands.ts`, `src/ui/agent.ts`)

## Theme config plan

- [ ] Extend the existing `settings.json` schema/loader with `theme` overrides and merge them into the active UI theme (`src/settings.ts`, `src/theme.ts`, `src/index.ts`, `spec.md`)
- [ ] Update tests and user-facing docs/help for the `settings.json`-based theme setup (`src/index.test.ts`, `src/ui/help.ts`, `README.md`, `spec.md`)
