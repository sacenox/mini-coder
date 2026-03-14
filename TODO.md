# TODO

- Improve our autocomplete via TAB. it should work on all commands and parameters. When the user uses tab assume it's a file path autocompletion.
- Tool hooks output prints inline with spinner
- When the user uses /new reset the terminal and clear the history, print the banner again
- Review our markdown renderer. Let's make it render the raw markdown, but syntax highlited
- add a spinner state showing the user when the undo snapshotting is happening
- Structuted output when a skill is auto loaded for the agent

---

## Lean and mean idea

Drop the suabgent tool completly, prefer using the shell tool to mimic the subagent behaviour. Ensure we still support our subagents features like commands in new processes and subagent types. Update the mini-coder skill to be a guide explaining how to use mc via shell tool. Revise our cli interface to ensure support. When mc is called with a prompt, make it exit after the loop. Like a one shot.
Drop glob and grep tools. the agents can use shell for these.
Do an extensive pass to cleanup tests, dead code and anything else that might have been related to our removals.

---

## UI Audit

- We need to revise all of our output to ensure consistency, **performance** and correctness.
- Ensure we have a good styled output that is clear to the user, refactor as needed.
- Ensure we have propper hierchy in output, and the different types of output are clearly distinguishable for the user, using styles and whitespace.
- Ensure proper spinner functionality, that follow up messages don't rended inline and that is doesn't break anything.

## CLI vs headless mode

- I need to understand this better tell me all about what is headless mode and what it does in our code.

---

## LSP Diagnostics (not very important, with tool-hooks and strong linting, this is not as necessary, but we should implement asap)

We should have a closed loop feedback for LSP diagnostics on edits/reads.

This could potentially be a very big slowdown, waiting for updated diagnostics every edit. This also has bias downsides, stale diagnostics confuse the LLM, and can cause negative distractions.

We need to do research first, but maybe we can leverage the hooks feature to achieve a similar result without the performance penalties? Needs brainstorming

---

## Deferred fixes

- model-info: in `resolveFromProviderRow`, when canonical capability exists but `contextWindow` is null, fall back to provider row context (`capability.contextWindow ?? row.contextWindow`).
- subagent-runner: avoid unconditional full buffering of child `stdout`/`stderr` in `runSubagent`; capture diagnostics only on failure or via a bounded tail buffer to prevent latency/memory regressions.
