# TODO

- Codebase is hurting from fast iteration and adding/removing features as well as core fundamental changes. We need to do a large refactoring based on the updated idea and remove the extra complexity and fragments of all the experimentation we did with other features.
- CTRL+d hangs sometimes and doesn't exit.

---

## Polish

- **Truncated tool commands** — Long `mc-edit` invocations truncate with `…` mid-argument (e.g. `--new '{…`). Could truncate at argument boundaries for clarity.
- **`sed` classification in shell icons** — `sed -n '1,200p'` (read-only) shows the `✎` write icon. Complex pipes like `grep … | sed …` show `?`. Could check for `-n`/`-i` flags, or classify `sed` as `$` (generic run).

---

# Deferred fixes

- `/_debug` hidden command that snapshots recent logs/db and creates a report in the cwd. For dev mostly but available to all. Do not list it anywhere, only documented here and in the code itself.
- Check this skill to learn about tmux and how we can use it to run manual tests. https://raw.githubusercontent.com/obra/superpowers-lab/refs/heads/main/skills/using-tmux-for-interactive-commands/SKILL.md

---

### LSP Diagnostics (not very important, with strong linting this is not as necessary, but we should implement asap, deferred)

We should have a closed loop feedback for LSP diagnostics on edits/reads.

This could potentially be a very big slowdown, waiting for updated diagnostics every edit. This also has bias downsides, stale diagnostics confuse the LLM, and can cause negative distractions.

We need to do research first and find an approach that fits the current shell-first architecture without the performance penalties. Needs brainstorming
