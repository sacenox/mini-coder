# TODO

## Bug with chat completions models (kimi 2.5 for example)

See bellow, there is the thinking spiner before each line, this doesn't happen with other models.

```
⠦ thinkingAdd reasoning indicator (e.g., "🤔" or "thinking") when `showReasoning` is true

⠧ thinkingPhase 5: Update Command Context & CLI Commands
⠏ thinkingFiles: `src/cli/commands.ts`, `src/agent/session-runner.ts`, `src/index.ts`

⠋ thinking1. Add `showReasoning` to `CommandContext`
⠹ thinking2. Add `/reasoning` command to toggle (on|off)
⠸ thinking3. Load/save preference from settings repo
⠼ thinking4. Pass setting through to `SessionRunner` and reporter

⠦ thinkingPhase 6: Update Output Reporter & Headless Reporter
⠧ thinkingFiles: `src/cli/output-reporter.ts`, `src/cli/headless-reporter.ts`

⠋ thinking1. Accept and forward `showReasoning` option
⠙ thinking2. Headless reporter: still consume reasoning events (for accumulation) but never render

Phase 7: Agent Integration
Files: `src/agent/agent.ts`

⠹ thinking1. Load `getShowReasoning()` preference
2. Pass to `CommandContext` and `SessionRunner`
⠸ thinking3. Update status bar calls to include reasoning flag

⠼ thinkingPhase 8: Help & Documentation
Files: `src/cli/commands.ts`

⠴ thinkingAdd `/reasoning` to help text

────────────────────────────────────────

⠦ thinkingFiles to Modify (in dependency order):

⠧ thinking1. `src/session/db/settings-repo.ts` - Add new setting functions
⠇ thinking2. `src/llm-api/types.ts` - Add reasoning to TurnResult (if needed)
⠋ thinking3. `src/agent/reporter.ts` - Update StatusBarData
4. `src/cli/stream-render.ts` - Add showReasoning option
⠙ thinking5. `src/cli/status-bar.ts` - Add reasoning indicator
⠹ thinking6. `src/cli/output-reporter.ts` - Forward option
⠸ thinking7. `src/cli/headless-reporter.ts` - Handle reasoning events
⠼ thinking8. `src/cli/commands.ts` - Add /reasoning command
⠴ thinking9. `src/agent/session-runner.ts` - Accept and pass through setting
⠦ thinking10. `src/agent/agent.ts` - Load preference, wire up
⠧ thinking11. `src/index.ts` - Load preference on startup
⠇ thinking12. `src/session/db/index.ts` - Export new functions

⠏ thinkingThis is a clean, incremental change that:
⠋ thinking· Maintains backward compatibility (defaults to showing reasoning)
⠙ thinking· Separates the "reasoning effort" setting from "reasoning display" setting
⠹ thinking· Properly accumulates reasoning text for message history
⠼ thinking· Works in both interactive and headless modes
kimi-k2.5  ✦ high  mmm7tm8p  ~/src/mini-coder  ⎇ main  ctx 37.9k/262.1k 14%  ↑ 172.2k ↓ 2.3k
▶
```

---

## Gpt 5.4 starts printing tool calls as the assistant message:

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

---

## Gpt codex context window maxinng out

I've noticed several sessions with codex spark that error because the context got too big for the model:

```
  ← read node_modules/@ai-sdk/google/src/google-generative-ai-language-model.ts:680+120
    · node_modules/@ai-sdk/google/src/google-generative-ai-language-model.ts  lines 680–799 of 1057  (truncated)
⠙ thinking{
  type: "error",
  sequence_number: 2,
  error: {
    type: "invalid_request_error",
    code: "context_length_exceeded",
    message: "Your input exceeds the context window of this model. Please adjust your input and try again.",
    param: "input",
  },
}
✖ [object Object]
✖ [object Object]
error: script "dev" exited with code 1
```

The same task with GPT 5.4: `ctx 82.8k/1050.0k 8%` used on 82k in context. I know spark is a smaller context, but I'm suprised by how often we max out the 128k context.

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
