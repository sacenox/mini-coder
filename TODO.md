# TODO

---

## Usbaility issues:

- **Rewrite subagents as subprocess `mc` sessions** — see `PLAN-subprocess-subagents.md`. The in-process runner is a second-class agent: it guesses paths, can't recurse, breaks Ralph mode, and produces lower-quality output than the main agent. Spawning a real `mc` subprocess fixes all of this in one move while keeping custom agent/command configs fully compatible.

- All models: constant reading almost no action, lot's of wasted tokens, using opencode or claude code is a much more action oriented workflow.

---

## Write blog posts

- Codex being big dumb and lazy without strong guidance in system prompt/instructions
- Keeping up codebase health when using agents to develop an applications. Avoid regressions, bad tests, lint etc.

---

# Post v1.0.0 work:

## Custom commands vs built-in commands

Let's clean things up:

- `/review` command should use the same code as a custom-commands, consolidate the two. We can create the global `/review` command in `~/.agents/commands` at app start if it doesn't exist. That way it can be a pure custom command and the users are encouraged to edit it for their own custom reviews. Never overwrite the file if it exists. Print a line notifying the user that the command was created.

---

## LSP Diagnostics (not very important, with tool-hooks and strong linting, this is not as necessary, but we should implement asap)

We should have a closed loop feedback for LSP diagnostics on edits/reads.

This could potentially be a very big slowdown, waiting for updated diagnostics every edit. This also has bias downsides, stale diagnostics confuse the LLM, and can cause negative distractions.

We need to do research first, but maybe we can leverage the hooks feature to achieve a similar result without the performance penalties? Needs brainstorming

---

## Deferred fixes

- model-info: in `resolveFromProviderRow`, when canonical capability exists but `contextWindow` is null, fall back to provider row context (`capability.contextWindow ?? row.contextWindow`).
- Worktrees share bun lockfile and node_modules. Question this choice, is this really a good idea, or just an opportunity for things to go wrong?
