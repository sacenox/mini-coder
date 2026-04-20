# TODO

Keep this always updated so work can continue across sessions.
Don't keep completed items bloating the file; remove them before committing.
Keep the file structured and minimal.
The spec and code are the sources of truth; this file is just the verified backlog.

## Open issues:

- [ ] Stream stops without finishing the turn after tools calls. happens in both headless and interactive mode.

### Conversation log virtualization / performance plan

Goal: replace the current message-count chunking with a real visible-slice virtual list and remove expensive preview/layout work from the scroll hot path.

- [ ] Run a focused benchmark for long sessions after the virtualization refactor and confirm the new path holds up.

# Defered issues:

- [ ] Read tool output should include line numbers to help the llm find it's anchors.
- [ ] If an agent uses readImage on a non-image file, mc crashes
- [ ] If a conversation is truncated away from the db when the UI is still open somewhere, the app crashes.

## Theme config plan

- [ ] Extend the existing `settings.json` schema/loader with `theme` overrides and merge them into the active UI theme (`src/settings.ts`, `src/theme.ts`, `src/index.ts`, `spec.md`)
- [ ] Update tests and user-facing docs/help for the `settings.json`-based theme setup (`src/index.test.ts`, `src/ui/help.ts`, `README.md`, `spec.md`)

## Verified UX / behavior debt

- [ ] Prevent `/session` from switching sessions mid-run (`src/ui/commands.ts`, `src/ui/agent.ts`)

## Product backlog

- [ ] Add first-class delegation/subagent support instead of relying on shell-level `mc -p` delegation (`src/agent.ts`, `src/tools.ts`, `src/prompt.ts`, `src/headless.ts`)
