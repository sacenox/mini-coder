# TODO

## Write blog posts

- Codex being big dumb and lazy without strong guidance in system prompt/instructions
- Keeping up codebase health when using agents to develop an applications. Avoid regressions, bad tests, lint etc.

---

## Websearch and webcontent don't have styled outputs

Currently they print json and raw text.
Refactor so they have a dedicated formatted output like the other builtin tools.

## Help agent edits error less:

- Agents sometimes include `|` at the end of the hashes passes to replace() and other tools, this is because how we display the hashed to them, with `|` as the separator. let's check if the anchor last char is `|` and strip it if it instead of letting it error.

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