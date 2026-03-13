# TODO

- Improve our autocomplete via TAB. it should work on all commands and parameters. When the user uses tab assume it's a file path autocompletion.
- Tool hooks output prints inline with spinner
- When the user uses /new reset the terminal and clear the history, print the banner again
- Review our markdown renderer. Let's make it render the raw markdown, but syntax highlited
- add a spinner state showing the user when the undo snapshotting is happening
- Structuted output when a skill is auto loaded for the agent

---

## Lean and mean idea

Drop the suabgent tool completly, prefer using the shell tool to mimic the subagent behaviour. Ensure we still support our subagents features like commands in new processes and subagent types. Update the mini-coder skill to be a guide explaining how to use mc via shell tool. Revise our cli interface to ensure support
Drop glob and grep tools. the agents can use shell for these.
Drop the read and write tools, we will need to revise the shell structured output to identify when we need to show diffs.
Do an extensive pass to cleanup tests, dead code and anything else that might have been related to our removals.

---

## UI Audit

Our output is currently not in a good spot, with weird newlines and inconsistent whitespace separation between tool calls, tool responses, and assistant response.

Audit our output to make sure it's refactored to the new tools and working correctly and performant and ensure propper whitespace.

---

## LSP Diagnostics (not very important, with tool-hooks and strong linting, this is not as necessary, but we should implement asap)

We should have a closed loop feedback for LSP diagnostics on edits/reads.

This could potentially be a very big slowdown, waiting for updated diagnostics every edit. This also has bias downsides, stale diagnostics confuse the LLM, and can cause negative distractions.

We need to do research first, but maybe we can leverage the hooks feature to achieve a similar result without the performance penalties? Needs brainstorming

---

## Deferred fixes

- model-info: in `resolveFromProviderRow`, when canonical capability exists but `contextWindow` is null, fall back to provider row context (`capability.contextWindow ?? row.contextWindow`).
- subagent-runner: avoid unconditional full buffering of child `stdout`/`stderr` in `runSubagent`; capture diagnostics only on failure or via a bounded tail buffer to prevent latency/memory regressions.
