# TODO

- Normalize the different models reasoning output. Trim excessive whitespace safely, ensure it renders uniquely. Should have a more structured output so it's noticeable that is reasoning and not a normal response. Enable the markdown rendering for it.
- Improve our autocomplete via TAB. it should work on all commands and parameters. When the user uses tab assume it's a file path autocompletion.
- Tool hooks output prints inline with spinner
- When the user uses /new reset the terminal and clear the history, print the banner again
- Review our markdown renderer. Let's make it render the raw markdown, but syntax highlited

---

# Lean and mean idea

CLI vs MCP is the hot debate. I've testing a lot with different coding editors and I want to make feature branch that removes the subagent tool. Then simplify our read/write tools, streamline their usage based on usage history. Then update the mini-coder skill to teach how to use "subagents" by calling another mc via shell, and general tool guidelines (don't bloat context with large outputs, dont read more than needed, etc...). Also review our exa tools for improvements. Overall this allows the agent to rely more on the shell tool and use the read/write tools for safe edits, and removing the complexity of the subagent tool.

Why this is good in my opinion:

- Way less code, much less bug surface, faster.
- Less tool implementation, simpler structured output logic
- Raw, simple and makes mini-coder closer to it's intented coding prompt vision (as oposed to an interactive coding agent with TUI)

---

## LSP Diagnostics (not very important, with tool-hooks and strong linting, this is not as necessary, but we should implement asap)

We should have a closed loop feedback for LSP diagnostics on edits/reads.

This could potentially be a very big slowdown, waiting for updated diagnostics every edit. This also has bias downsides, stale diagnostics confuse the LLM, and can cause negative distractions.

We need to do research first, but maybe we can leverage the hooks feature to achieve a similar result without the performance penalties? Needs brainstorming

---

## Deferred fixes

- model-info: in `resolveFromProviderRow`, when canonical capability exists but `contextWindow` is null, fall back to provider row context (`capability.contextWindow ?? row.contextWindow`).
- subagent-runner: avoid unconditional full buffering of child `stdout`/`stderr` in `runSubagent`; capture diagnostics only on failure or via a bounded tail buffer to prevent latency/memory regressions.
