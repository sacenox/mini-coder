# mini-coder

A fast, transparent, config-first terminal coding agent for one user at a time.

This document records the intent and the decisions behind the code. The code is
the source of truth for behavior; this is the contract for anyone changing it.

## Intent

- A small, auditable agent core with no hidden machinery.
- A minimal system prompt with no injected meta-guidance.
- Provider work delegated entirely to `pi-ai`.
- Durable, user-owned, readable session logs.
- An append-only TUI with a small bounded live region and no full-screen buffer.
- First-class local (Ollama / llama.cpp / vLLM) and hosted models on equal footing.

Prior art is reference, not template. `x.x.x-archive` holds the previous
implementation; `../awl/` (append-only live-region TUI, config-driven design),
`../bough/` (layer boundaries), and `../agent-ide/` (session durability, streaming)
are references. Extract ideas, do not port code.

## Hard constraints

- **Node.js directly.** No Bun, no Deno, no `Bun.*`, no Bun package scripts.
  Everything must work with `node`/`npm`.
- **No TUI library or framework.** No `cel-tui`, `OpenTUI`, `blessed`, `Ink`, or
  React. Render with direct `process.stdout` ANSI writes and plain strings.
- **`pi-ai` owns the provider layer.** All model requests, provider adapters,
  wire formats, streaming, auth resolution, and usage accounting go through
  `@earendil-works/pi-ai`. Never re-implement a provider protocol or fork it.
- **Do not copy other coding agents' source code.** Pi and `pi-ai` are behavioral references; write original code.
- **No sandboxing, no permission layer.** Tools run with the user's permissions.
  Isolation is an environment concern (`nono`), not the agent's. No jail,
  approval gate, or supervisor.
- **No loop limits.** No max turns, tool calls, token budgets, or agent-imposed
  timeouts. The user's ability to interrupt is the limit.
- **Config-first.** Every user-facing behavior that can vary comes from config
  with a sane default.
- **Minimal context.** The model sees only the configured system prompt plus
  explicitly opted-in resource files. No doom-loop reminders, hidden
  `<system-reminder>` blocks, internal-behavior text, or harness meta-text.

## Runtime and repo shape

- TypeScript, ESM, `"type": "module"`, `strict`, `erasableSyntaxOnly`,
  `verbatimModuleSyntax`.
- TypeScript runs directly through Node's native type stripping (`node src/cli.ts`).
  Use relative imports with explicit `.ts` extensions. Avoid non-erasable syntax
  (`enum`, `namespace`, parameter properties, legacy decorators).
- `bin/mini-coder.ts` is a thin shebang shim importing `src/cli.ts`.
- Module boundaries (names may change, boundaries may not move):
  - `cli` — argument parsing, mode selection, process wiring.
  - `config` — load, validate, merge, resolve config; build `pi-ai` models.
  - `session` — append-only JSONL store of `pi-ai` `Message`s.
  - `agent` — streaming loop, tool dispatch, pause/cancel state. No UI, no
    provider-specific code.
  - `tools` — `edit`, `bash` runners. No UI.
  - `prompt` — system-prompt assembly (config, skills, `AGENTS.md`).
  - `tui` — terminal live region and input editor; a projection of agent events.
- The agent must not import `tui`. The TUI must not own agent or provider
  semantics. Headless and TUI are two projections of the same agent events.

## Configuration

Global config only, at `$XDG_CONFIG_HOME/mini-coder/config.json`
(default `~/.config/mini-coder/config.json`). No project-local config, no
config-override flags. A missing file is valid and uses defaults.

Because `pi-ai` owns the provider catalog, auth env vars, base URLs, wire APIs,
and compat detection, model config stays thin. A built-in provider needs only
`provider` + `model`; `customProviders` exists only for endpoints `pi-ai` does
not ship.

Fields and defaults:

- `sessionsDir` — root for per-session directories. Default `<cwd>/sessions`.
- `systemPrompt` — base system prompt. Default `""`.
- `discoverAgentFiles` — include discovered `AGENTS.md`/`CLAUDE.md`. Default `true`.
- `skillsDirs` — directories scanned for `SKILL.md`. Default `[]` (no skills).
- `tools` — enabled tool names. Default `["edit", "bash"]`.
- `provider` — built-in `pi-ai` provider id or a `customProviders[].id`.
  Default `"anthropic"`.
- `model` — model id within that provider. Default `"claude-sonnet-4-5"`.
- `thinkingEffort` — one of `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.
  Default `"medium"`.
- `customProviders` — array; default `[]`. Each entry:
  - `id` (matches the active `provider`),
  - `name` (display; defaults to `id`),
  - `baseUrl`,
  - `api` — explicit `pi-ai` wire id: `openai-completions`,
    `openai-responses`, `anthropic-messages`, or `google-generative-ai`. Never
    inferred from a name or URL,
  - `models` — model ids served there,
  - `envKeys` — optional credential env vars; omit for keyless local servers,
  - `headers` — optional extra request headers.

Decisions:

- Built-in models are looked up in `pi-ai`'s catalog. Do not duplicate catalog
  data or env vars in mini-coder.
- Omitted custom-model metadata uses safe defaults (`reasoning: false`,
  `input: ["text"]`, zero cost, 200k context, 32k max tokens). `pi-ai`
  auto-detects `compat` from `baseUrl`; add overrides only when a concrete
  endpoint misbehaves.
- `headers` merge into requests and are kept out of session records.
- Unknown `tools` names and unknown config keys are config errors. Validate at
  load and name the failing field.

## Provider integration

Use `pi-ai` entrypoints: `builtinModels()` / `createModels()`,
`createProvider({ id, name, baseUrl, auth, models, api })`,
`envApiKeyAuth(displayName, envVars)`,
`models.streamSimple(model, context, { reasoning, signal, sessionId })`, and the
`Type` re-export. Import API implementations only from
`@earendil-works/pi-ai/api/<api>.lazy` so unused provider SDKs are not bundled.

Decisions:

- Register built-ins with `builtinModels()` and custom entries with
  `createProvider`. Keyless custom providers get a stub auth that resolves a
  placeholder key rather than an env lookup.
- Auth is entirely `pi-ai`'s. Credentials resolve from env vars only; stored
  credentials, login flows, and a persistent `CredentialStore` are deferred.
- Keep the adapter thin. Consume `pi-ai` message/stream types directly; do not
  translate them into a parallel model. Keep provider-specific continuation data
  (opaque blocks, signatures) intact in the session.

## Session persistence

`pi-ai` ships no session store. The session layer is a thin append-only JSONL
wrapper around `pi-ai`'s own `Message` type. Never invent a parallel message
model.

One JSON object per line; never rewrite or delete committed lines. Records:

- `{ type: "session", version: 1, id, cwd, createdAt, title }` — first line,
  written once.
- `{ type: "request", at, provider, model, api, thinkingEffort, systemPrompt,
  tools }` — written before each model request, capturing resolved inputs.
- `{ type: "message", at, message }` — each conversation message, stored as a
  `pi-ai` `Message` verbatim.

Directory and file layout:

```
<sessionsDir>/<YYYYMMDD>-<HHmmss>-<slug>-<shortid>/session.jsonl
```

- The directory name is the session `id` and the canonical key. Never rename it.
- `YYYYMMDD-HHmmss` is UTC creation time, keeping `ls` chronological.
- `slug` comes from the first user message: lowercased, non-alphanumerics
  collapsed to `-`, trimmed, truncated to ~40 chars, falling back to `session`.
  The same function produces the `title`.
- `shortid` is 6 random base36 chars, disambiguating same-second, same-title
  sessions.
- Ensure `sessionsDir` recursively; create the session directory with exclusive
  `mkdirSync` and regenerate `shortid` on `EEXIST` (bounded attempts). No locks.
- Create lazily on the first user message so the slug is meaningful; the session
  is in-memory before that.
- One writer per session directory.
- Append with `writeSync` + `fsyncSync` so committed lines survive a crash. A
  persistence failure stops the turn; never continue with unrecorded side
  effects.
- Preserve message order and tool-call ↔ tool-result relationships.
- Reading sessions back is deferred; when it is added, tolerate a truncated
  final line, reject corruption in committed history, and use `pi-ai`'s
  `AssistantMessageFrameEncoder` / `reduceAssistantMessageFrames` rather than a
  custom frame format.

## Agent loop

One loop, no limits. Per turn: assemble `{ systemPrompt, tools, messages }`,
`for await` over `streamSimple`, surface text/reasoning/tool-call events, append
the final assistant message, then execute any tool calls in order, appending
each result, and repeat. Stop when the assistant produces no tool calls, on
cancel, or on a surfaced error.

Phases: `preparing`, `waitingModel`, `streaming`, `runningTool`, `pausing`,
`idle`; a turn may be cancelled from any active phase. Events: `phase`, `text`,
`reasoning`, `toolCall`, `toolOutput`, `toolResult`, `message`, `error`,
`cancelled`, `complete`.

Decisions:

- No compaction, summarization, or context rewriting.
- No automatic retries. Provider errors are surfaced, not hidden.
- No reminders or meta-messages between steps.
- The loop is driven by an `AbortSignal` and checks pause state at step
  boundaries (top of each iteration and before each tool call).

## Tools

`edit` and `bash` only. Stateless; recoverable failures return tool-result text,
not thrown errors. There is no `read` tool — the model reads files with Unix
tooling through `bash`. Tool arguments are untrusted input and are validated at
the boundary with Typebox (`Value.Parse`); application logic uses plain types.

- **`edit`** — `{ path, oldText, newText }`. Exact find-and-replace. Fails when
  `oldText` is missing or matches more than once. Empty `oldText` creates a new
  file and fails if it exists. Returns a unified diff via `createTwoFilesPatch`
  from the `diff` package. Checks the abort signal before writing.
- **`bash`** — `{ command }`. Runs `bash -c` in `process.cwd()` in its own
  process group (`detached: true`) so cancellation can kill the whole tree.
  Streams stdout/stderr through `onOutput`, then returns combined output plus
  exit code. On abort, SIGTERM the group, then SIGKILL after a short grace.
  Output is bounded (10k head + 6k tail) and truncation is reported in
  `details` (`truncated`, `omittedChars`, `totalChars`) rather than silently
  dropped. No default timeout.

Only tools named in config `tools` are exposed and may execute. No approval
prompts, sandboxing, or per-tool budgets.

## System prompt assembly

In order: config `systemPrompt`, then skills (when `skillsDirs` is non-empty),
then agent files (when `discoverAgentFiles`).

- Agent files: load `AGENTS.md` and `CLAUDE.md` from `~/.agents/` and the project
  root (`process.cwd()`), trimmed, each under a heading naming its path.
- Skills: scan each `skillsDirs` entry for `<dir>/<name>/SKILL.md`, read its
  frontmatter (`name`, `description`), and advertise the absolute path so the
  model can read it with `bash` on demand. Progressive disclosure only — never
  inline skill bodies. No directories means no skills; there is no implicit
  global or project-local discovery.
- No other injected instructions, reminders, or environment blobs.

## TUI

Normal terminal screen. No alternate screen, no full-screen buffer, no
persistent cursor modes. Styling is unconstrained: SGR attributes and colour,
live or committed, are the renderer's choice, and `src/tui/` owns it. No flicker:
coalesce writes (16ms frame cadence) and never redraw committed output.

Two regions:

- **Committed history** — printed once to terminal scrollback and never
  redrawn. User turns, assistant text, tool calls, and tool results go here. The
  terminal owns scrollback, selection, and scrolling.
- **Live region** — at most the height of the terminal minus one row, holding
  a one-row context-usage readout, the in-flight line (the current incomplete
  line of whichever stream is active), a one-row phase status, and the editor,
  in that order. Only this region is redrawn. When idle it holds the context
  readout and the editor: no in-flight line, no status row.

The context readout is always present, including idle, and is display-only: it
estimates the tokens the next request would send against `model.contextWindow`
and is never persisted. Anchor on the last `AssistantMessage.usage` — the prompt
that was sent is `totalTokens - output` — and estimate the anchor message and
everything after it; fall back to a ~1 token per 4 characters estimate of the
whole context. Emphasize as it approaches the window, and mark it full when
`used + model.maxTokens` would exceed it.

Scrollback is append-only and written before the live region is redrawn, never
after. Blocks — a user turn, a tool call with its result body, a terminal-state
line — are separated by exactly one blank line, never two, and never as the
first line. Each tool block is committed as a unit when its result arrives, so a
call and its body stay contiguous even when one assistant message announces
several calls before any of them runs.

Redraw: move to the top of the live region, erase to end of screen, rewrite.
Track the region's height exactly: it changes when the status row appears or
disappears and when the in-flight line wraps, so erasing it means erasing every
occupied row, not one. When content is committed, print it above the live region
and shrink the region before the next frame. On `SIGWINCH`, drop the cursor
anchor and re-anchor rather than guessing; never erase committed history. Handle
wrapping, Unicode width, and tiny terminals without corrupting scrollback.

Input editor (notepad-level, not Vim/readline parity): multiline
insertion/deletion, cursor movement across lines, reliable typing, backspace,
newline, and large bracketed paste. `Enter` submits; `Ctrl+J` inserts a newline
(`Shift+Enter` also maps to newline where the terminal sends it). The draft
survives redraws, cancellation, and errors. No undo/redo, history search, or
path completion.

Terminal lifecycle: raw mode only in interactive mode; bracketed paste enabled;
restore prior mode, cursor visibility, and modified state on exit, cancel, and
`SIGINT`/`SIGTERM`. Re-read size on resize. Use `process.stdout.columns`/`rows`
with fallbacks for `0`/undefined. Escape sequences are parsed by a small state
machine with a short timeout to distinguish a lone ESC from a sequence.

## Interruption and lifecycle

- **ESC = polite pause request.** It never interrupts the current step: the
  in-flight model request completes and the running tool runs to completion. The
  loop then pauses at the next boundary for a steering message, which is
  appended before the turn continues.
- **CTRL+C = cancel the turn completely.** Abort the model request via
  `AbortSignal` and terminate the running tool's process group. Persist the
  aborted assistant message (`stopReason: "aborted"`). Return to idle; do not
  undo completed side effects. When idle, it clears a non-empty draft instead.
- **CTRL+D = exit**, only when the input is empty. Flush the session, restore the
  terminal, exit cleanly.
- No max turns, tool-call budget, or automatic stop.

## Headless mode

`-p` / `--print` is the only CLI interface and the only flag. It runs one prompt
to completion non-interactively and prints the final assistant answer to stdout.
Accepted spellings: `-p <prompt>`, `--print <prompt>`, `-p=<prompt>`,
`--print=<prompt>`; unknown arguments are errors.

- Persists the session under `sessionsDir` exactly like interactive mode; the
  JSONL log is the durable record. No other machine-readable stdout mode.
- Diagnostics, tool progress, and errors go to stderr.
- Never emit ANSI escapes or terminal controls when not a TTY; never wait for
  prompts.
- Exit `0` on success, non-zero on failure/cancel.

## Reliability and diagnostics

- Persistence failure stops the turn.
- Surface provider errors with their message; do not mask, summarize, or retry.
- Local diagnostics only. No remote telemetry. Any debug output would go to
  stderr behind an explicit flag; redact secrets and prompt/tool content by
  default.
- No hidden stalls: every wait (model request, tool, pause) has a visible state
  in the TUI; in headless mode tool calls, tool output, errors, and
  cancellation are written to stderr.

## Scope boundaries

Deferred, not rejected. Do not build unless explicitly promoted:

- context compaction / summarization / masking;
- reading or resuming sessions (the JSONL log is write-only today);
- prompt templates;
- custom agents / subagents / delegation;
- an extension or plugin system;
- a settings TUI or overlay editors;
- custom OAuth or auth implementations (use `pi-ai`'s provider auth);
- MCP, image generation, multi-agent orchestration;
- sandboxing, approval prompts, permission policies;
- tests and CI (standing rule: no tests unless asked);
- macOS/Windows behavior and cross-platform abstractions. Target Linux first.

## Working agreement

- Read `pi-ai`'s README and the reference projects before designing. Trace the
  real data flow; apply guards at the narrowest boundary.
- Keep the diff small. Do not opportunistically refactor or harden adjacent
  code.
- Prefer plain functions and objects over classes; keep exports minimal; define
  helpers near their use.
- Validate untrusted input once at the boundary (config, tool args) with
  Typebox, then keep internal code plain-typed. Do not spread schema-derived
  types everywhere.
- Ask before adding a dependency. `diff` and `typebox` are approved;
  supply-chain risk is a real constraint.
- Do not add tests unless explicitly asked. Verify manually.
- Before finishing, review the diff against the hard constraints and the scope
  boundaries, remove anything that added scope, and report any requirement that
  could not be satisfied.
