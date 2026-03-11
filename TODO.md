# TODO

## Custom subagents are broken:

They are being called with the wrong arguments, or something is going wrong in the call, see the errors bellow:

Claude attempt:

```
◆ Now I have all the context I need. Handing off to the writer! 🖊️
  ⇢ [toolu_] — Write an exciting blog post draft announcing that mini-co…
⣟ subagenterror: Script not found "zen/claude-sonnet-4-6"
    ✖ Subagent subprocess produced no output (exit code 1)
```

Kimi 2.5 attempts:

```
 I have a good understanding of the project now. Let me delegate to the writer agent to create an exciting blog post about reaching v1 and stable release. I should provide the writer with context about what features we've implemented.
  ⇢ [functi] — Write an exciting blog post draft announcing that mini-co…
◆ error: File not found "zen/kimi-k2.5"
    ✖ Subagent subprocess produced no output (exit code 1)

  The subagent didn't produce output. Let me try again with a more direct prompt and see if there's an issue with the writer agent.
◆  Let me check the writer agent configuration and try again:
  ← read .agents/agents/writer.md
    · .agents/agents/writer.md  44 lines
◆
  The writer agent looks fine. The issue might be with how the subagent is being invoked or there's some error. Let me try running the writer subagent again with a simpler prompt.
◆
  ⇢ [functi] — Write an exciting blog post draft about mini-coder reachi…
◆ error: File not found "zen/kimi-k2.5"
    ✖ Subagent subprocess produced no output (exit code 1)

  The subagent is failing silently. Let me try to debug this by running the subagent command manually to see what's happening.
◆   Let me debug the subagent issue:
  $ cd ~/src/mini-coder && mc @writer "Write a 100 word blog post about c…
    timeout
 The user is asking me to delegate to the "writer" subagent to write a 100-word blog post about coding agents. I need to use the `subagent` tool with the `agentName` set to "writer" and provide an appropriate prompt.
    │   ⇢ [functi] — Write a 100 word blog post about coding agents. Informal,…
◆ error: File not found "zen/kimi-k2.5"
    │     ✖ Subagent subprocess produced no output (exit code 1)
```

```
◆  Now let me try using the subagent correctly:
  ⇢ [functi] — Write an exciting blog post draft about mini-coder reachi…
◆ error: File not found "zen/kimi-k2.5"
    ✖ Subagent subprocess produced no output (exit code 1)
```

---

## LSP Diagnostics (not very important, with tool-hooks and strong linting, this is not as necessary, but we should implement asap)

We should have a closed loop feedback for LSP diagnostics on edits/reads.

This could potentially be a very big slowdown, waiting for updated diagnostics every edit. This also has bias downsides, stale diagnostics confuse the LLM, and can cause negative distractions.

We need to do research first, but maybe we can leverage the hooks feature to achieve a similar result without the performance penalties? Needs brainstorming

---

## Deferred fixes

- model-info: in `resolveFromProviderRow`, when canonical capability exists but `contextWindow` is null, fall back to provider row context (`capability.contextWindow ?? row.contextWindow`).
- Worktrees share bun lockfile and node_modules. Question this choice, is this really a good idea, or just an opportunity for things to go wrong?
- `subagent-runner.ts`: `Bun.file(proc.stdio[3] as unknown as number).text()` — the double-cast signals a type mismatch. Investigate whether `new Response(proc.stdio[3]).text()` is more correct and whether the current form breaks silently across Bun versions.
- `worktree.ts` tracked-change sync: `copyFileSync` turns symlinks into regular files. Preserve symlinks via `lstatSync(...).isSymbolicLink()` + `readlinkSync`/`symlinkSync` (or restore git-native apply for tracked changes).
