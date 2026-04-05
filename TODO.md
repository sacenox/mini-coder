# Implementation plan

## Phase 1 — Foundation (no UI, no LLM)

- [x] `session.ts` — SQLite schema, CRUD, turn numbering, undo, fork, cumulative stats
- [x] `session.test.ts` — 20 tests against real in-memory bun:sqlite
- [x] `tools.ts` — `edit` (exact-text replace, new file creation) and `shell` (exec, output truncation)
- [x] `tools.test.ts` — 27 tests: edit (13), shell (8), truncateOutput (6)
- [x] `git.ts` — branch, dirty counts, ahead/behind, repo root detection (10 tests)

### Notes from Phase 1

- `session.ts` exports: `openDatabase`, `createSession`, `getSession`, `listSessions`, `deleteSession`, `appendMessage`, `loadMessages`, `undoLastTurn`, `forkSession`, `computeStats`.
- Internal row types (`SessionRow`, `MaxTurnRow`, `DataRow`) and a `SQL` constants object keep queries centralized and avoid formatter conflicts.
- `@mariozechner/pi-ai` is the only runtime dependency so far. Its `Message`, `AssistantMessage`, `UserMessage`, `ToolResultMessage` types are used for session persistence.
- `tools.ts` exports: `ToolExecResult`, `EditArgs`, `executeEdit`, `ShellArgs`, `ShellOpts`, `executeShell`, `truncateOutput`, `editTool`, `shellTool`, `ReadImageArgs`, `executeReadImage`, `readImageTool`. All execute functions return `ToolExecResult` (`{ content: (TextContent | ImageContent)[], isError }`). pi-ai `Tool` definitions use TypeBox schemas.
- `git.ts` exports: `getGitState` → `GitState | null`. Runs 4 git commands in parallel. Internal `parseStatus` parses porcelain v1 format (uses `trim=false` to preserve leading-space column).
- biome `noNonNullAssertion` rule disabled globally — non-null assertions after explicit null checks are idiomatic in tests.
- 57 tests total across 3 files (session: 20, tools: 27, git: 10).
- `diff` package added as dependency for unified diffs in edit tool output (Phase 4 UI).

## Phase 2 — Context assembly

- [x] `skills.ts` — SKILL.md discovery, frontmatter parsing, catalog generation, name collision resolution
- [x] `skills.test.ts` — 14 tests: single/multi path discovery, name collision, missing dirs, frontmatter (none, missing fields, multi-line, quoted), catalog XML
- [x] `prompt.ts` — AGENTS.md discovery, system prompt construction (base + AGENTS.md + skills + plugins + git footer)
- [x] `prompt.test.ts` — 21 tests: AGENTS.md walk (5), git line formatting (6), system prompt assembly (10)

### Notes from Phase 2

- `skills.ts` exports: `Skill` interface, `discoverSkills(scanPaths)`, `buildSkillCatalog(skills)`. Minimal YAML frontmatter parser (no dependency) handles `name`, `description`, folded scalars (`>`), quoted values. Falls back to directory name when frontmatter `name` is absent.
- `prompt.ts` exports: `AgentsMdFile` interface, `BuildSystemPromptOpts` interface, `discoverAgentsMd(cwd, scanRoot, globalAgentsDir?)`, `formatGitLine(state)`, `buildSystemPrompt(opts)`. Both `discoverSkills` and `discoverAgentsMd` take paths as parameters — the actual scan paths (spec §"Agent Skills" discovery, §"AGENTS.md" scan root priority) are determined by the caller (`index.ts` in Phase 4).
- Base instructions in `prompt.ts` match spec.md §"Base instructions" verbatim.
- `readImage` is intentionally absent from base instructions per spec — conditionally registered via tool definitions only.
- 92 tests total across 5 files (session: 20, tools: 27, git: 10, skills: 14, prompt: 21).

## Phase 3 — Agent loop

- [x] `readImage` tool in `tools.ts` — base64 encoding, mime detection, path resolution
- [x] `tools.test.ts` — 9 new readImage tests (36 total: edit 13, shell 8, truncateOutput 6, readImage 9)
- [x] `agent.ts` — core loop: stream → handle events → execute tools → loop. Interrupt handling.
- [x] `agent.test.ts` — 12 tests with faux provider: text response, tool execution, multi-tool, chaining, turn numbering, events, interrupt, error, unknown tool, length stop
- [x] `plugins.ts` — plugin types, config loading, init/destroy lifecycle
- [x] `plugins.test.ts` — 10 tests with real plugin modules in temp dirs: config loading, init, config passthrough, error handling, tool collection, destroy lifecycle

### Notes from Phase 3

- `readImage` in `tools.ts`: `ReadImageArgs`, `executeReadImage`, `readImageTool`. Returns `ImageContent` on success (base64 + mimeType) or text error, both via `ToolExecResult`.
- `agent.ts` exports: `ToolHandler` (function type), `ToolExecResult` (re-exported from `tools.ts`), `AgentEvent`, `RunAgentOpts`, `AgentLoopResult`, `runAgentLoop`. `RunAgentOpts` takes `tools: Tool[]` (definitions for the model) and `toolHandlers: Map<string, ToolHandler>` (dispatch map). The loop streams via `streamSimple`, dispatches tool calls through the handler map, appends all messages to DB with the same turn number, and emits events for UI updates. Unknown tools produce error results so the model can self-correct.
- `plugins.ts` exports: `AgentContext`, `PluginResult`, `Plugin`, `PluginEntry`, `LoadedPlugin`, `loadPluginConfig`, `initPlugins`, `destroyPlugins`. `PluginResult.tools` is `Tool[]` (pi-ai definitions), `PluginResult.toolHandlers` is `Map<string, ToolHandler>` (optional). Plugins are real modules loaded via dynamic `import()` — tested with actual `.ts` files in temp dirs (no mocks).
- Context limit compaction is deferred — the spec notes "the specifics will be refined during development." The agent loop structure supports adding it as a pre-stream check.
- Conditional `readImage` registration (only for vision-capable models) will be handled by the caller (`index.ts`) checking `Model.input.includes("image")`.
- `cel-tui` (`@cel-tui/core`, `@cel-tui/components`) added as dependencies for the TUI.
- 123 tests total across 7 files.

## Phase 4 — UI

### 4a — Input parsing (TDD, no UI)

- [x] `input.ts` — pure logic for parsing user input:
  - `/command` detection and routing (extract command name + args)
  - `/skill:name rest of message` → skill body + user text
  - Image path detection (entire input is an existing image path with valid extension)
- [x] `input.test.ts` — 30 tests: command detection (6), skill references (6), image paths (12), plain text (4), priority (2)

### Notes from Phase 4a

- `input.ts` exports: `COMMANDS` (const tuple), `Command` type, `ParsedInput` discriminated union, `ParseInputOpts`, `parseInput(raw, opts?)`. Pure logic — no IO beyond `existsSync` for image path validation.
- `theme.ts` (also implemented here): `Theme` interface, `DEFAULT_THEME`, `mergeThemes(base, ...overrides)`. Uses terminal palette colors (`color01`–`color08`) for automatic light/dark adaptation. 5 tests in `theme.test.ts`.
- 158 tests total across 9 files (session: 20, tools: 36, git: 10, skills: 14, prompt: 21, agent: 12, plugins: 10, input: 30, theme: 5).

### Notes from Phase 4b

- `index.ts` exports: `AppState` (all mutable app state), `init()`, `buildPrompt(state)`, `buildToolList(state)`, `shutdown(state)`. Also re-exports OAuth helpers (`loadOAuthCredentials`, `saveOAuthCredentials`, `DATA_DIR`, `AUTH_PATH`) for `/login` and `/logout` commands.
- Provider discovery checks env-based API keys first, then saved OAuth tokens (`~/.config/mini-coder/auth.json`). Refreshes expired tokens and persists updates.
- Model selection picks the first model from the first provider with models, or `null` if none. No `process.exit` — the TUI starts regardless so the user can `/login`.
- Tool wiring: `buildTools` returns `{ tools: Tool[], toolHandlers: Map<string, ToolHandler> }`. Built-in handlers are a plain record. Plugin tools and handlers are merged from `PluginResult`.
- `ToolExecResult` is now the single result type in `tools.ts`. `ToolResult` and `ReadImageResult` were removed. All execute functions return `ToolExecResult` directly.
- `AgentTool` wrapper type removed from `agent.ts`. The agent loop takes `tools: Tool[]` + `toolHandlers: Map<string, ToolHandler>` separately.
- 158 tests still pass across 9 files.

### 4b — App shell (running app, no commands)

- [x] `index.ts` — entry point: provider discovery (env + OAuth), model selection (first available, null if none), startup sequence, `main()` wires init → startUI
- [x] `ui.ts` — cel-tui layout: conversation log (scrollable, stick-to-bottom), input area (TextInput, submit/newline), status bar (2 lines: cwd+git, model+usage), animated divider
- [x] Wire agent loop: submit → build context → stream → render events → tool results → loop
- [x] Message rendering: user (bg color), assistant (streamed Markdown), tool calls (shell: bordered output, edit: path + unified diff), errors
- [x] Interrupt: Escape during streaming aborts via AbortSignal

### Notes from Phase 4b (ui.ts)

- `ui.ts` exports: `startUI(state)`. Single entry point that owns the cel-tui lifecycle (`cel.init` / `cel.stop`).
- Layout matches the spec diagram: scrollable conversation log (flex: 1) → animated divider → TextInput (maxHeight: 10) → static divider → status bar (height: 2).
- Animated divider: scanning pulse (bright `═` segment sweeps across dimmed `─` line) via `setInterval` at 60ms. Starts on agent loop start, stops on completion.
- Message rendering: user messages get `bgColor` from theme, assistant messages use `Markdown()` component, tool calls get left border (`│`) with dimmed text. Edit tool calls show unified diff via `structuredPatch` from the `diff` package. Streaming response rendered from accumulation buffers + pending tool call list.
- Agent loop wiring: `submitMessage` appends user message to DB (turn auto-assigned by `appendMessage`), refreshes git state, builds prompt + tools, runs `runAgentLoop` with `onEvent` callback. Events update streaming buffers and trigger `cel.render()`.
- Key bindings: Enter submits (returns `false` in `onKeyPress` to prevent newline), Escape interrupts running agent, Ctrl+C / Ctrl+D graceful exit.
- `Theme` type changed from `string` values to cel-tui `Color` type — eliminates `as any` casts throughout the UI.
- `tsconfig.json`: removed `noImplicitReturns` for cel-tui compatibility (their `onKeyPress` callbacks return `false | void`).
- `spec.md`: removed `submitKey: "enter"` reference — cel-tui uses the `onKeyPress` return-false pattern instead.
- 158 tests still pass across 9 files.

### 4c — Commands

- [x] `/model` — interactive model selector (Select component, available providers/models)
- [x] `/effort` — effort level selector
- [x] Overlay layer system for interactive Select commands
- [x] Wire `parseInput()` into Enter handler, route commands vs text
- [ ] `/session` — session manager (list, resume, delete)
- [ ] `/new` — new session, reset counters
- [ ] `/fork` — fork current session
- [ ] `/undo` — remove last turn
- [ ] `/reasoning` — toggle thinking display
- [ ] `/verbose` — toggle full output (disable truncation)
- [ ] `/login` / `/logout` — OAuth flows via pi-ai
- [ ] `/help` — list commands, AGENTS.md files, skills, plugins
- [ ] `/` + Tab — command autocomplete in input

### Notes from Phase 4c

- Overlay system: cel-tui multi-layer viewport. `activeOverlay` module state holds a `SelectInstance` + title. When active, `cel.viewport()` returns `[base, overlayLayer]`. Overlay is a centered modal with `padding: { x: 4 }` and fixed height (`OVERLAY_MAX_VISIBLE + 3`), `bgColor: theme.overlayBg`.
- Escape dismissal: cel-tui intercepts Escape at the framework level (unfocuses before `onKeyPress` fires), so overlay dismissal uses `onBlur: dismissOverlay` instead of `onKeyPress`.
- `/model` builds items from `getAvailableModels(state)` (new helper in `index.ts`), marks current with `(current)` suffix, `filterText` includes both provider and model id.
- `/effort` shows 4 levels (low/medium/high/xhigh), marks current.
- `handleInput()` routes through `parseInput()` → `handleCommand()` for commands, `submitMessage()` for text. Skill and image cases are stubs for Phase 4d.
- `Theme` gained `overlayBg: Color` (default `"color08"`).
- 158 tests still pass across 9 files.

### 4d — Polish

- [ ] Tab file path autocomplete in input
- [ ] `/skill:name` input handling (strip prefix, prepend skill body)
- [ ] Image embedding (entire input is image path → embed as ImageContent)
- [ ] Conditional `readImage` tool registration (only for vision-capable models, re-evaluated on `/model`)
- [ ] Context limit compaction (threshold detection, model-generated summary, prompt cache preservation)

## Future ideas

- [ ] User preferences persistence (model, effort) — not in spec, currently resets to defaults on launch
- [ ] Divider theme plugin — customizable divider animations. Candidates designed during Phase 4 UI exploration:
  - **Scanning pulse** (current default): bright segment sweeps across the dimmed divider
  - **Breathing**: divider alternates between two dim levels, subtle pulse
  - **Flowing dots**: dot characters move along the divider like a marquee
  - **Wave**: characters cycle through `─` / `═` to create a moving wave effect
