# TODO

Keep this always updated so work can continue across sessions.
Don't keep completed items bloating the file; remove them before committing.
Keep the file structured and minimal.
The spec and code are the sources of truth; this file is just the verified backlog.

## Open issues:

- [ ] We are changing the spec and adding auto compaction. When the context pressure gets to 90% compact the oldest ~40% of messages in context. The compaction process does an individual agent call to summarize the messages being compacted the compaction prompt should mention the user request, so compaction stays relevant, this summary replaces the messages removed. With the summary include a <system-message> block informing the agent that he can read these messages again if needed from the db and include the path to the sqllite3 db and the session id for convenience. This way, even with a lossy summarization, if there is the need to retrive something the agent can. In the case that compactions happens, more than once, be careful to not compact previous compaction results.

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
