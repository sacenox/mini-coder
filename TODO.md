# TODO

---

## LSP Diagnostics (not very important, with tool-hooks and strong linting, this is not as necessary, but we should implement asap)

We should have a closed loop feedback for LSP diagnostics on edits/reads.

This could potentially be a very big slowdown, waiting for updated diagnostics every edit. This also has bias downsides, stale diagnostics confuse the LLM, and can cause negative distractions.

We need to do research first, but maybe we can leverage the hooks feature to achieve a similar result without the performance penalties? Needs brainstorming

---

## Gpt 5.4, Gpt 5.3 codex both starts printing tool calls as the assistant message:

A fix was made:

· Commit: `35738e1`
· Message: `fix(llm-api): avoid duplicate system prompt on responses models`
· Scope: `src/llm-api/turn.ts` only

Currently testing with gpt models to see if the fix is effective.

```
  ← read src/llm-api/turn.test.ts:108+50
    · src/llm-api/turn.test.ts  lines 108–142 of 142
  ✎ replace src/llm-api/turn.test.ts 116:1c–140:39
⠴ replace    ✔ hook post-replace
    ✔ replaced src/llm-api/turn.test.ts
    --- src/llm-api/turn.test.ts
    +++ src/llm-api/turn.test.ts
    @@ -113,11 +113,6 @@
                });
        });

    -   test("leaves non-Gemini models untouched", () => {
    -           const messages = [
    -                   { role: "user", content: "go" },
    -                   {
    -                           role: "assistant",
        test("leaves non-Gemini models untouched", () => {
                const messages: CoreMessage[] = [
                        { role: "user", content: "go" },
  ← read src/llm-api/turn.test.ts:108+40
    · src/llm-api/turn.test.ts  lines 108–137 of 137
◆ to=functions.shell  彩神争霸大发json
{"command":"bun test src/llm-api/turn.test.ts && bun run typecheck","timeout":120000}ո՟иҭanalysis to=functions.shell code
{"command":"bun test src/llm-api/turn.test.ts && bun run typecheck","timeout":120000} frontcompatto=functions.shell  手机上天天中彩票json
{"command":"bun test src/llm-api/turn.test.ts && bun run typecheck","timeout":120000}({
})Oopsto=functions.shell  彩神争霸官方څjson
{"command":"bun test src/llm-api/turn.test.ts && bun run typecheck","timeout":120000}We need ensure JSON only.to=functions.shell  ส่งเงินบาทไทยjson

error: script "dev" exited with code 130
```

I was not able to reproduce the same behaviour with opencode using the same provider. Which points to an issue with our code.

The issue is more rare, but still happening agfter the fix we tried. Let's investigate further and try to find the real root cause.

---

## Deferred fixes

- model-info: in `resolveFromProviderRow`, when canonical capability exists but `contextWindow` is null, fall back to provider row context (`capability.contextWindow ?? row.contextWindow`).
- Worktrees share bun lockfile and node_modules. Question this choice, is this really a good idea, or just an opportunity for things to go wrong?
- `subagent-runner.ts`: `Bun.file(proc.stdio[3] as unknown as number).text()` — the double-cast signals a type mismatch. Investigate whether `new Response(proc.stdio[3]).text()` is more correct and whether the current form breaks silently across Bun versions.
- `worktree.ts` tracked-change sync: `copyFileSync` turns symlinks into regular files. Preserve symlinks via `lstatSync(...).isSymbolicLink()` + `readlinkSync`/`symlinkSync` (or restore git-native apply for tracked changes).
