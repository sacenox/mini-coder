# TODO

## Refactor and add color to shell tool console output

When the llm uses the shell tool, it shows the following patterns:

- Chained shell commands `cd ... && cat ...` and even longer chains.
- `mc-edit` calls weaved into cat and other shell calls.

These patterns affect how we render the calls to the user, with most call lines being truncated early and not showing the important parts of the shell call. We could show these as a structured human readable.

Coloring the outputs, could we just ask for colors when running shell commands safely, maybe set an env var for the subprocess? Then we could just let those colors render.

`mc-edit` could be improved to print a colored diff.

- Check the db for most used commands. We don't need to support the whole shell ecosystem, just take a sample of the most used.
- Use yoctocolors for the coloring of the diffs in mc-edit.
- This is about the output for the **user** the llm get's the no color, as is today.

---

## Deferred fixes

- Investigate using tmux to allow agents to use mc from a users perspective
- Subagent and shell tools are very similar, shell could do what subagent does without changes. This could be leveraged to reduce code. Subagent process runner is used for custom commands that fork context as well, there will need to be refactored.
- `/_debug` hidden command that snapshots recent logs/db and creates a report in the cwd. For dev mostly but available to all. Do not list it anywhere, only documented here and in the code itself.

---

### LSP Diagnostics (not very important, with strong linting this is not as necessary, but we should implement asap)

We should have a closed loop feedback for LSP diagnostics on edits/reads.

This could potentially be a very big slowdown, waiting for updated diagnostics every edit. This also has bias downsides, stale diagnostics confuse the LLM, and can cause negative distractions.

We need to do research first and find an approach that fits the current shell-first architecture without the performance penalties. Needs brainstorming
