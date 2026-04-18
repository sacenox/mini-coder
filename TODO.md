# TODO

Keep this always updated so work can continue across sessions.
Don't keep completed items bloating the file; remove them before committing.
Keep the file structured and minimal.
The spec and code are the sources of truth; this file is just the verified backlog.

## Open issues:

- [ ] Fix headless `mc` not exiting after one-shot runs complete; explicit process exit after shutdown may be the missing piece (`src/index.ts`, `src/headless.ts`)
- [ ] Consolidate syntax-highlighting themes and fix `SyntaxHighlight` usage so markdown/code/tool rendering stays consistent (`src/ui/conversation.ts`, `src/theme.ts`)

## UI render scheduling fix plan (completed)

- [x] Centralize UI-triggered renders behind a scheduler in `src/ui.ts` so streaming, tool, and divider updates coalesce instead of calling `cel.render()` blindly
- [x] Stop redundant synchronous render requests from cel-managed input, scroll, and overlay paths while keeping their state mutations intact
- [x] Route async agent/runtime updates through the scheduler with lower-priority streaming/animation requests and normal-priority committed-state updates
- [x] Add focused UI tests for render coalescing/priorities, then remove the frozen-streaming open issue after verification

## Spec-alignment backlog

- [ ] Make invalid `settings.json` non-fatal at startup. Per spec, invalid or missing settings content should behave like "no saved settings" instead of aborting launch (`src/settings.ts`, `src/index.ts`)
- [ ] Clear queued steering messages on reset boundaries so they cannot leak across `/new`, `/undo`, `/session`, or aborted/replaced runs (`src/submit.ts`, `src/ui/commands.ts`, `src/agent.ts`)
- [ ] Encode Escape-over-overlay behavior in app code instead of relying on overlay blur side effects. The first `Escape` should dismiss the overlay, preserve the draft, and not interrupt the run (`src/ui.ts`, `src/ui/commands.ts`)
- [ ] Omit empty git fields from the system-prompt git line. Detached HEAD should not render `Git: branch ` (`src/prompt.ts`, `src/git.ts`)
- [ ] Return structured `shell` results that preserve stdout, stderr, and exit code instead of flattening everything into one text blob (`src/tool-shell.ts`, `src/tools.ts`, `src/ui/conversation.ts`)
- [ ] Escape skill catalog values before injecting them into the `<available_skills>` XML block (`src/skills.ts`, `src/prompt.ts`)

## Verified UX / behavior debt

- [ ] Prevent `/session` from switching sessions mid-run (`src/ui/commands.ts`, `src/ui/agent.ts`)
- [ ] Preserve the current slash-command draft when opening command autocomplete instead of clearing the input (`src/ui.ts`, `src/ui/commands.ts`)

## Product backlog

- [ ] Add loop safeguards that fit the no-step-limit spec: retry policy, tool-failure/request budgets, and doom-loop detection/reminders without introducing a hard step cap (`src/agent.ts`, `src/submit.ts`, `src/prompt.ts`)
- [ ] Add dedicated read/search tools so the model relies less on `shell` for code discovery (`src/tools.ts`, `src/prompt.ts`, `src/ui/conversation.ts`)
- [ ] Add first-class delegation/subagent support instead of relying on shell-level `mc -p` delegation (`src/agent.ts`, `src/tools.ts`, `src/prompt.ts`, `src/headless.ts`)
- [ ] Improve headless output when `--json` is not passed so it shows lightweight activity updates before the final answer (simple assistant commentary/snippets only; no tool-call details or reasoning) (`src/headless.ts`, `src/index.ts`)

## Plugin debt (verified, deferred)

- [ ] Make plugin lifecycle match the spec: initialize once at startup and destroy on shutdown, not on prompt-context reload boundaries (`src/index.ts`, `src/plugins.ts`)
- [ ] Match the plugin tool execution API to the spec/docs instead of the temporary `tools` + `toolHandlers` split (`src/plugins.ts`, `src/index.ts`, `spec.md`)
- [ ] Keep `Plugin AgentContext.messages` current or narrow the contract so it is not stale (`src/index.ts`, `src/plugins.ts`, `spec.md`)
- [ ] Support package-name and config-relative plugin imports (`src/plugins.ts`)
- [ ] Prefix plugin tool rendering with `plugin/tool` in the log when available (`src/index.ts`, `src/ui/conversation.ts`)

## Benchmark harness debt

- [ ] Make the Harbor mini-coder wrappers use headless JSON mode (`mc --json -p ...`) instead of final-text mode mislabeled as NDJSON (`terminal-bench/mini_coder_agent.py`, `terminal-bench/mini_coder_local_agent.py`)
