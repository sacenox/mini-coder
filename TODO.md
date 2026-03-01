# TODO

## Write blog posts

- Codex being big dumb and lazy without strong guidance in system prompt/instructions
- Keeping up codebase health when using agents to develop an applications. Avoid regressions, bad tests, lint etc.

---

## CTRL+c during a tool call still exits the app instead of interrupting.

As the title says, see example output:

```
gpt-5.3-codex  mm8agcuc  ~/src/mini-coder  ⎇ main  ctx 31.8k/128.0k 25%  ↑502.9k ↓2.9k
▶ /release
· release [.agents/commands/release.md]

$ $ bun run typecheck && bun run format && bun run lint && bun test
  ✔ 0
← read package.json:1+200
  · 37 lines
✎ replace package.json 3:a0–3:a0
⠹ thinking    ✔ hook post-replace
  ✔ replaced package.json
$ $ bun run build
  ✔ 0
$ $ git add -A && git commit -m "chore: release v0.0.10" && git tag v0.0.…      <- Shell command hanguing waiting for user input for the git tag call
error: script "dev" exited with code 130                                         <- ctrl+c by the user in hopes to return to the prompt, but app exited.
```
---

## `/model` thinking-effort toggle

The idea specifies: *"/model allows the user to pick a model as well as thinking
effort for the model if supported. Selection persists across sessions."*

`runTurn()` in `src/llm-api/turn.ts` builds `streamOpts` with no `providerOptions`,
so thinking effort is never forwarded to the SDK. The `settings` table (via
`getSetting`/`setSetting` in `src/session/db.ts`) is already available for
persistence alongside `preferred_model`.

Research model capabilities and if we can fetch them automatically from providers (from the model list maybe?)
For the models that support reasoning, show the options when listing models with `/models`

---

## LSP Diagnostics

We should have a closed loop feedback for LSP diagnostics on edits/reads.

This could potentially be a very big slowdown, waiting for updated diagnostics every edit. This also has bias downsides, stale diagnostics confuse the LLM, and can cause negative distractions.

We need to do research first, but maybe we can leverage the hooks feature to achieve a similar result without the performance penalties? Needs brainstorming