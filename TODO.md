# TODO

## Worktrees feature is not working as expected.

Currently it completly breaks the subagent tool as the changes are discard when the subprocess exits. They are never consolidated with the current agents filesystem, essentially making subagents no-op always.

Our worktrees implementation never worked correctly, and I think we need to remove it for now. Let's take the opportunity to simplify and refactor for better code readability and organization of the code.

---

## ESC cleared the whole last turn from memory

See the output bellow, once interrupted and prompted about it's actions, the assitant was not aware of any previous input from the user. Notice the context numbers also reset to 0%.

It should have seen it's previous work and have context of the conversation.

```
⣻ replace    ✔ hook post-replace
    ✔ replaced src/tools/worktree.test.ts
    --- src/tools/worktree.test.ts
    +++ src/tools/worktree.test.ts
    @@ -167,12 +167,13 @@

                writeFileSync(join(wtPath1, "README.md"), "branch one\n");
                git(wtPath1, ["commit", "-am", "branch one"]);
    -
    -           writeFileSync(join(wtPath2, "README.md"), "branch two\n");
    -           git(wtPath2, ["commit", "-am", "branch two"]);

    -           const firstMerge = await mergeWorktree(repoDir, branch1);
    -           expect(firstMerge.success).toBe(false);
    +           // Start a manual merge to create a merge in progress state
    +           try {
    +                   git(repoDir, ["merge", branch1]);
    +           } catch {
    +                   // This is expected to fail with conflicts
    +           }

                try {
                        await mergeWorktree(repoDir, branch2);
gemini-3.1-pro  ✦ high  🤔  mmmgnqvc  ~/src/mini-coder  ⎇ main  ctx 40.3k/1048.6k 4%  ↑ 464.1k ↓ 11.7k
▶
gemini-3.1-pro  ✦ high  🤔  mmmgnqvc  ~/src/mini-coder  ⎇ main  ctx 40.3k/1048.6k 4%  ↑ 464.1k ↓ 11.7k
▶ What are you doing? Did you read what I told you?
◆ I am ready to assist you. I have read the guidelines and understand my role as mini-coder, a small and fast CLI coding agent.

I'm prepared to use my tools to search, read, edit code, run commands, and execute tests as needed to implement solutions autonomously. What would you like me to work on?
gemini-3.1-pro  ✦ high  🤔  mmmgnqvc  ~/src/mini-coder  ⎇ main  ctx 1.6k/1048.6k 0%  ↑ 465.8k ↓ 11.9k
▶
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
