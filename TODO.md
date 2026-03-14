# TODO

- ~~Remove markdown rendering from reasoning blocks. render raw in dimmed color. Remove the leading | character but keep the ident. Could we make it italic easily?~~ ✓ Done — reasoning renders raw, dim+italic, 2-space indent; `inFence` reset at block boundaries.
- Investigate db lock issues with spawning parallel subagents:

```
  ⇢ — Audit scope: CLI/input/output/command behavior against mi…
  ⇢ — Audit scope: tools/core/session/provider/MCP behavior aga…
  ⇢ — Audit scope: repository docs and user-facing documentatio…
    ✖ Subagent subprocess produced no output (exit code 7) (diagnostics: 60 |                   cleanup(); | 61 |                      t)
    ✖ Subagent subprocess produced no output (exit code 7) (diagnostics: 60 |                   cleanup(); | 61 |                      t)
    ⇢ subagent done (882751in / 10514out tokens)
◆ Subagent parallelism hit a SQLite lock in the shared app DB, so I’m finishing the audit with direct reads and a smaller follow-up pass grounded in file references.
```

- read tool path issues, says file not found on valid path:

```
· reasoning
│ Investigating duplicate progress lines
  ← read ~/src/mini-coder/src/cli/stream-render.ts:1+360
    ✖ File not found: ~/src/mini-coder/src/cli/stream-render.ts
· reasoning
│ Deciding relative path usage
  ← read src/cli/stream-render.ts:1+380
    · src/cli/stream-render.ts  296 lines
```

- `src/cli/stream-render.ts` is 448 lines; could be split for maintainability
- `src/llm-api/turn.ts` is 1273 lines; handles many concerns (pruning, compacting, normalization)

---

# Console output/UI updates:

- add a spinner state showing the user when the undo snapshotting is happening and more granular output of tools lifecycle: start, running, hooks, and done states.
- Structuted output when a skill is auto loaded for the agent and improve context pruning output to match out style

Implement these improvements.

---

## UI Audit

- We need to revise all of our output to ensure consistency, **performance** and correctness.
- Ensure we have a good styled output that is clear to the user, refactor as needed.
- Ensure we have propper hierchy in output, and the different types of output are clearly distinguishable for the user, using styles and whitespace.
- Ensure proper spinner functionality, that follow up messages don't rended inline and that is doesn't break anything.

---

## LSP Diagnostics (not very important, with tool-hooks and strong linting, this is not as necessary, but we should implement asap)

We should have a closed loop feedback for LSP diagnostics on edits/reads.

This could potentially be a very big slowdown, waiting for updated diagnostics every edit. This also has bias downsides, stale diagnostics confuse the LLM, and can cause negative distractions.

We need to do research first, but maybe we can leverage the hooks feature to achieve a similar result without the performance penalties? Needs brainstorming

---

## Deferred fixes

- model-info: in `resolveFromProviderRow`, when canonical capability exists but `contextWindow` is null, fall back to provider row context (`capability.contextWindow ?? row.contextWindow`).
- subagent-runner: avoid unconditional full buffering of child `stdout`/`stderr` in `runSubagent`; capture diagnostics only on failure or via a bounded tail buffer to prevent latency/memory regressions.
- Subagent and shell tools are very similar, shell could do what subagent does without changes. This could be leveraged to reduce code. Subagent process runner is used for custom commands that fork context as well, there will need to be refactored.
- `/_debug` hidden command that snapshots recent logs/db and creates a report in the cwd. For dev mostly but available to all. Do not list it anywhere, only documented here and in the code itself.
