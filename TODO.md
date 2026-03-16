# TODO

## Bugs:

- None

---

## Colored shell output

We could look into coloring the most used shell commands.

- Check the db for most used commands.
- Use yoctocolors for the coloring.

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
