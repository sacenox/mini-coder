# TODO

## Write blog posts

- Codex being big dumb and lazy without strong guidance in system prompt/instructions
- Keeping up codebase health when using agents to develop an applications. Avoid regressions, bad tests, lint etc.

---

# Context window sizes are out of date

CONTEXT_WINDOW_TABLE in providers.ts is out of date.  Codex 5.3 and 5.2 have 400k tokens context limit not 128.
This list looks **VERY** wrong, let's get the facts from model.dev and update our list.

`curl https://models.dev/api.json`

Let's use the curl command above to update our table.

---

## Subagents are not really used that much.

The main agent should be making use of these to ensure a clean and enduring context window. Search results, codebase reading, etc bloat the context.
Is short the main agent should delegate to subagents as much as he can.  Some tools like the exa powered web tools, also generate big responses, which makes sense
since they are fetching content, but we should analyze them to see if we can trim the data.

- Check the database for suabgent tool usage statistics
- Check the current language and instructions around the subagent tool
- Audit read/web tools responses for context bloat (anything that doesn't help the agent's decision making)

Note: I've done some changes to the system-prompt.ts to try and ecourage more subagent usage.

---

# Post v1.0.0 work:

## Custom commands vs built-in commands vs subagents

We currently have a ton of overlap with these features, Commands run within subagents, some commands come from custom configs others are baked in.

Let's clean things up:

- `/review` command should use the same code as a custom-commands, consolidate the two.  We can create the global `/review` command in `~/.agents/commands` at app start if it doesn't exist.  That way it can be a pure custom command and the users are encouraged to edit it for their own custom reviews. Never overwrite the file if it exists. Print a line notifying the user that the command was created.

- Custom commands and custom subagents:  Custom commands just spawn generic subagents with a dedicated prompt, custom agents are just subagents with a dedicated system prompt and a main agent provided prompt.  I believe these are already well implemented, and share most of the code.

---

## LSP Diagnostics (not very important, with tool-hooks and strong linting, this is not as necessary, but we should implement asap)

We should have a closed loop feedback for LSP diagnostics on edits/reads.

This could potentially be a very big slowdown, waiting for updated diagnostics every edit. This also has bias downsides, stale diagnostics confuse the LLM, and can cause negative distractions.

We need to do research first, but maybe we can leverage the hooks feature to achieve a similar result without the performance penalties? Needs brainstorming