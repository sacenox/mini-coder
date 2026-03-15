# TODO

- Strange output mid session:

There are several sessions in the db where this issue happened.

A fix was made to suppress commentary from gpt to avoid this, but now there is no reasoning output from gpt mdels.
Update: reasoning is now all dumped at turn end.

The issue is not fixed, it's just suppressed.
This seems like an issue on how we are parsing stream events, and not recognzing tool calls from other events.

neither pi or opencode have this bug with the same provider, and opencode uses the same sdks as we do
use the `gh` tool to clone and inspect how they avoid this issue

Expectation: Gpt models don't produce corrupted output and correctly display reasoning

Relevant reasoning output:

```
I keep running into issues with tool syntax, and it feels like it's because of the interface. I really need to use the correct commentary to call functions.shell. It's important to stick to the standard format to get it right. I wonder if I should double-check the documentation or examples to be sure I’m following things correctly. Just trying to make sure I figure this out! There's probably something simple I'm overlooking.It seems my interface isn’t accepting the call because I’m in analysis mode. I need to ensure I’m using the assistant message with the tool call instead. I should remember to use the correct wrapper like I did previously. It feels a bit tricky, but I’ll get it right this time! Let’s make sure everything is in place so it works smoothly moving forward.Hmm, it feels like I'm having issues emitting a tool call. It's puzzling! I remember previous successful calls used that specific syntax with JSON in the content, and I wonder if an accidental unicode might be causing the issue. I think it’s worth trying to stick to that normal syntax I used earlier. Let’s see if that works! My goal is to get this resolved so I can assist effectively.**Trying to resolve issues**

  I’m thinking maybe my last few attempts didn’t work because I didn’t include the recipient name. But I believe the functions should work with the shell style I used earlier. I’ll make sure to try using the multi_tool method again with the exact syntax I had. I'm curious if that’ll make a difference in the process. Let’s see how it goes!
```

```
  I'm considering whether to replace lines 90-94 with a single blank. I think using `newContent=""` might be supported here, so let’s try it out with just `""` and see if it works. It's a simple enough change, but I want to make sure this approach will actually accomplish what I need without causing unintended issues. Let’s see how this plays out!to=functions.replace  玩彩神争霸ությունը  ฝ่ายขายละครើ្យិបង្គ{"path":"src/cli/tool-render.test.ts","startAnchor":"90:c5","endAnchor":"94:03","newContent":"","cwd":"/home/xonecas/src/mini-coder"}Hmm, it looks like my tool call was malformed due to some weird characters. That's kind of frustrating! I need to retry that call but make sure I format it correctly this time. It's probably just a matter of checking my inputs and ensuring everything’s in order. I’ll give it another go and see if I can sort this out! Fingers crossed for a smoother process!to=functions.replace  全民彩票天天ിയացում 开号链接նայած{"path":"src/cli/tool-render.test.ts","startAnchor":"90:c5","endAnchor":"94:03","newContent":"","cwd":"/home/xonecas/src/mini-coder"}to=functions.replace าคาร่json  天天中彩票中েছে{"path":"src/cli/tool-render.test.ts","startAnchor":"90:c5","endAnchor":"94:03","newContent":"","cwd":"/home/xonecas/src/mini-coder"}to=functions.replace  天天中彩票篮球json  ฝ่ายขายละคร  大发快三彩票{"path":"src/cli/tool-render.test.ts","startAnchor":"90:c5","endAnchor":"94:03","newContent":"","cwd":"/home/xonecas/src/mini-coder"}**Considering tool usage**

  I’m noticing that something seems off with the current approach. It could be related to how data is being handled. I wonder if I should consider using a multi-tool approach, but I think maybe it’s unnecessary. Instead, it seems best to just carefully type out the exact information needed to avoid any weird issues that could arise. I want to get this right for the user!to=functions.replace  体育彩票天天json  彩神争霸大发快三{"path":"src/cli/tool-render.test.ts","startAnchor":"90:c5","endAnchor":"94:03","newContent":"","cwd":"/home/xonecas/src/mini-coder"}**Considering file editing methods**

  I'm wondering if I've hit a weird issue with the system from copying. I might switch to using the shell to write the file, even though the guidelines prefer a dedicated method. Using the shell with `cat` could work since the file is now small. I remember that I should always read a file before editing it. Maybe I’ll use `cat <<'EOF' > src/cli/tool-render.test.ts` for a clean overwrite. I'll need to be careful with this approach!A dedicated edit tool is being finicky on this one tail cleanup, so I’m overwriting just this already-read test file cleanly via shell and then validating.to=functions.shell  天天中彩票软件inspector  qq天天中彩票 เติมเงินไทยฟรี  大发快三开奖 彩娱乐彩票  彩神争霸下载 玩彩神争霸 ดลองใช้ฟรีjson
```

Corruption example, there are several sessions in our database where this happened with gpt models

```
◆ Progress update: I’ve implemented a first UX-focused refactor around tool-stream visibility and am now validating stream/event tests plus a manual `bun run dev` run for one-shot tool calls.{"command":"bun test src/llm-api/turn-stream-events.test.ts src/llm-api/turn-execution.test.ts src/cli/tool-render-call.test.ts","timeout":120000}{"command":"bun test src/llm-api/turn-stream-events.test.ts src/llm-api/turn-execution.test.ts src/cli/tool-render-call.test.ts","timeout":120000} to=functions.shell code{"command":"bun test src/llm-api/turn-stream-events.test.ts src/llm-api/turn-execution.test.ts src/cli/tool-render-call.test.ts","timeout":120000} to=functions.shell เงินไทยฟรีto=functions.shell  重庆时时彩杀 ￣亚洲json
{"command":"bun test src/llm-api/turn-stream-events.test.ts src/llm-api/turn-execution.test.ts src/cli/tool-render-call.test.ts","timeout":120000}{"command":"bun test src/llm-api/turn-stream-events.test.ts src/llm-api/turn-execution.test.ts src/cli/tool-render-call.test.ts","timeout":120000}to=functions.shell 񹚊ppjson
{"command":"echo hi","timeout":30000}to=functions.shell  天天买彩票  ಕ್ರಮ`
Let's try once carefully.
{"command":"..."}
```

with function chosen by previous? Wait earlier had "to=functions.shell". yes must include like:
`to=functions.shell  彩神争霸官网json
{"command":"bun test ...","timeout":120000}{"command":"git status --short","timeout":30000}` with to=functions.shell in metadata. Here UI likely hidden. I'll follow same exact:
{"command":"bun test src/llm-api/turn-stream-events.test.ts src/llm-api/turn-execution.test.ts src/cli/tool-render-call.test.ts","timeout":120000} to=functions.shell
to=functions.shell 天天中彩票买json
{"command":"bun test src/llm-api/turn-stream-events.test.ts src/llm-api/turn-execution.test.ts src/cli/tool-render-call.test.ts","timeout":120000}to=multi_tool_use.parallel үрүмjson
{"tool_uses":[{"recipient_name":"functions.shell","parameters":{"command":"bun test src/llm-api/turn-stream-events.test.ts src/llm-api/turn-execution.test.ts src/cli/tool-render-call.test.ts","timeout":120000}}]}to=functions.shell 天天中彩票追号json
{"command":"echo test","timeout":30000}{"command":"git status --short","timeout":30000}

```
with assistant metadata to=functions.shell from UI (not visible in message maybe I set via tool button). In raw text here maybe cannot set to=. Actually we
· reasoning
  **Checking repository status**
  **Inspecting project structure before testing**
  **Planning source inspection**
  **Checking package scripts for testing**
  **Planning stepwise refactor**
  **Testing interactive and one-shot runs**
  **Planning interactive test approach**
  **Inspecting output streaming complexity**
  **Inspecting stream render content**
  **Assessing stream event processing**
  **Inspecting tool call event handling**
  **Considering execution buffering**
  **Planning UI streaming consistency improvements**
  **Exploring interactive session simulation**
  **Investigating command echo and rendering issues**
  **Inspecting provider options for simplification**
  **Identifying rendering issue source**
  **Planning streamlining and cleanup**
  **Assessing streaming rendering issues**
  **Assessing spinner lifecycle**
  **Assessing stream renderer refactor**
  **Assessing provider option complexity**
  **Analyzing caching implementation inconsistencies**
  **Planning provider option refactor**
  **Planning incremental tool-call rendering fix**
  **Modifying test and refactoring stream handling**
  **Adjusting case formatting**
  **Verifying tool-call presence**
  **Restoring missing case for direct chunks**
  **Refactoring test line to use maps**
  **Running targeted test**
  **Testing manual dev run**
  **Refining tool call rendering and deduplication**
  **Updating shell section**
  **Replacing anchors**
  **Checking existing tests for tool rendering**
  **Adding tests for shell and read edge cases**
  **Running targeted tests**
  **Implementing synthetic ID aliasing**
  **Reintroducing skip logic for empty tool-input-start**
  **Editing input start case**
  **Replacing anchors now**
  **Updating test for id omission**
  **Verifying event handling tests**
  **Correcting tool usage**
  **Correcting JSON format in call**
  **Correcting syntax format**
  **Adjusting tool call format**
  **Identifying malformed input issue**
  **Correcting recipient inclusion**
  **Checking mode compatibility**
  **Considering alternative command order**
  **Addressing tool call issues**
  **Diagnosing tool call syntax issue**
  **Identifying silent execution failure**

  __User interrupted here__

  gpt-5.3-codex  ·  ~/src/mini-coder  ·  ✦ medium  ·  ⎇ main  ·  tok 2143.4k/8.5k  ·  ctx 71.0k/400.0k 18%  ·  #mmqw0u3y
  ▶
```

- Models in general struggle with our read/write tools, use the db to investigate their behaviour with out tools and let's refactor them with the goal of reducintg errors.
- UI hangs for a short time before reasoning blocks. Reasoning blocks lost their italic styling.

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
