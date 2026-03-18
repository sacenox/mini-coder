# TODO

- Reaching max tool calls causes a 400 error
- CTRL+d hangs sometimes and doesn't exit

## Deferred fixes

- `/_debug` hidden command that snapshots recent logs/db and creates a report in the cwd. For dev mostly but available to all. Do not list it anywhere, only documented here and in the code itself.

---

### LSP Diagnostics (not very important, with strong linting this is not as necessary, but we should implement asap)

We should have a closed loop feedback for LSP diagnostics on edits/reads.

This could potentially be a very big slowdown, waiting for updated diagnostics every edit. This also has bias downsides, stale diagnostics confuse the LLM, and can cause negative distractions.

We need to do research first and find an approach that fits the current shell-first architecture without the performance penalties. Needs brainstorming
