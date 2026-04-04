# mini-coder — spec

A CLI coding agent. Small, fast, focused.

## Motivation for rewrite

The previous version tried to own too much: custom UI rendering, a provider
abstraction layer, markdown streaming, interactive widgets. Maintaining all of
that alongside the actual agent logic was too much scope. This rewrite narrows
the focus to **being a good coding agent** by leaning on two solid external
packages for the hard parts (LLM providers and terminal UI).

## Principles

1. **Lean on proven dependencies** — don't reimplement what a library does well.
2. **Flat, simple codebase** — no workspace packages, no internal abstraction layers beyond what the code naturally needs.
3. **Agent-first** — every decision serves the goal of reading code, making changes, and verifying them via the shell.
4. **Performance** — startup and turn latency matter more than features.

## Core dependencies

### `@mariozechner/pi-ai` — LLM provider layer

Unified LLM API that handles everything we used to struggle with:

- **Multi-provider**: Anthropic, OpenAI, Google, Bedrock, Mistral, Groq, xAI, OpenRouter, Ollama, and many more.
- **Streaming**: Rich event protocol (`text_delta`, `thinking_delta`, `toolcall_start/delta/end`, `done`, `error`).
- **Tool calling**: TypeBox schemas, validated arguments, streaming partial JSON.
- **Context**: Simple `{ systemPrompt, messages, tools }` structure. Serializable. Supports cross-provider handoffs.
- **Token/cost tracking**: Built into every `AssistantMessage.usage`.
- **OAuth**: OpenAI Codex, GitHub Copilot, Google Gemini CLI, Antigravity — browser-based login flows.
- **Model registry**: Auto-discovery from env vars, curated model metadata (context windows, costs, capabilities).
- **Thinking/reasoning**: Unified `ThinkingLevel` across providers.

This replaces: `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`, and all the provider glue code.

### `cel-tui` — terminal UI

Declarative TUI framework with flexbox layout, built for exactly the kind of UI we need:

- **Primitives**: `VStack`, `HStack`, `Text`, `TextInput` — composable, flexbox-based.
- **Components**: `Markdown` (streaming-aware), `Button`, `Select`, `Divider`, `Spacer`.
- **Input**: Kitty keyboard protocol, proper key handling, mouse scroll/click.
- **Rendering**: Differential cell-buffer rendering, synchronized output (no flicker).
- **Scroll**: Controlled/uncontrolled scroll with stick-to-bottom support.
- **Focus**: Tab/Shift+Tab traversal, controlled/uncontrolled focus.

The chat example (`cel-tui/examples/chat.ts`) is essentially a skeleton of our UI. Markdown streaming, TextInput, scroll — it's all there.

This replaces: `yoctocolors`, `yoctomarkdown`, `yoctoselect`, and all our custom widget/rendering code.

### Other dependencies

- **Runtime**: Bun — for runtime, bundling, testing, and `bun:sqlite`.
- **Schema validation**: TypeBox (re-exported from pi-ai) for tool schemas.

## Tools

Two built-in tools, plus a read-only image tool. Plugins may add more (see [Plugins](#plugins)).

### `shell`

Runs a command in the user's shell. Returns stdout, stderr, and exit code.

Implementation details:

- Large outputs are truncated (keeping head + tail with a middle marker) to avoid context explosion.
- The truncation threshold is configurable, tuned to keep useful output while staying well within context limits.
- Commands run via `$SHELL -c "<command>"` (falling back to `/bin/sh` if `$SHELL` is unset) with the CWD set to the session's working directory.
- Timeout: no default timeout. The user can interrupt via `Escape`.

### `edit`

Exact-text replacement in a single file.

Implementation details:

- Takes a file path (absolute, or relative to the session CWD), the old text to find, and the new text to replace it with.
- Fails deterministically if the old text is not found or matches multiple locations. Returns the error message so the model can self-correct.
- Create new files by passing empty old text and the full file content as new text. Parent directories are created automatically.
- Returns a confirmation or error message — no diff output (the agent already knows what it wrote).
- Encoding: reads and writes UTF-8. Preserves the file's existing line endings.

### `readImage`

Reads an image file and returns it as `ImageContent` (base64 + mimeType). This lets the model inspect screenshots, diagrams, or any image in the repo without the user explicitly attaching it.

Implementation details:

- Accepts a file path. Supports common formats: PNG, JPEG, GIF, WebP.
- Returns `ImageContent` in the tool result (pi-ai's `ToolResultMessage.content` supports images natively).
- Only registered when the current model supports image input. Hidden from models that don't.

## Community standards

### AGENTS.md

Reference: https://agents.md

There is no formal spec — AGENTS.md is a de facto convention established by Codex, Claude Code, pi, and others. The common behavior across implementations is to walk the directory tree toward root, collecting every `AGENTS.md` found.

Our discovery:

- Walk from CWD toward the **scan root**, collecting every `AGENTS.md` (and `CLAUDE.md`) found.
- Scan root, in priority order: **git root** (if in a repo) → **home directory** (fallback) → filesystem root (only if `MC_AGENTS_ROOT=/` is set).
- Also check `~/.agents/` for global agent instructions (cross-client convention).
- All files are additive, ordered root-to-leaf (general → specific).

This avoids walking to filesystem root on deep paths. In practice, the scan root is almost always the git root.

Contents are appended to the system prompt after the base instructions as project-specific context.

### Agent Skills (agentskills.io)

Reference: https://agentskills.io/specification — full format spec.
Reference: https://agentskills.io/client-implementation/adding-skills-support — client implementation guide.

We follow the spec's progressive disclosure model:

1. **Discovery** — at session start, scan for directories containing `SKILL.md` in:
   - `<project>/.mini-coder/skills/`
   - `<project>/.agents/skills/`
   - `~/.mini-coder/skills/`
   - `~/.agents/skills/`

   The spec does not mandate discovery paths — these are our client-specific choices, following the convention from the client implementation guide. Project-level skills override user-level skills on name collision.

2. **Catalog** — skill names + descriptions are disclosed in the system prompt so the model knows what's available. Low token cost (~50-100 per skill).

3. **Activation** — the model activates skills by reading the `SKILL.md` file via the shell tool. No dedicated activation tool needed — the model already has file access. The catalog includes the absolute path to each `SKILL.md`.

4. **User activation** — users can reference skills with `/skill:skill-name` in the prompt input. The skill body is injected into the user message directly.

Relative paths in skills are resolved against the skill's directory. The system prompt instructions explain this to the model.

## Plugins

Plugins extend mini-coder with new tools and context. They are the mechanism for optional capabilities that don't belong in the core — MCP servers, custom tools, integrations.

### Interface

A plugin is a module that exports a function conforming to a simple interface:

```ts
interface Plugin {
  name: string;
  description: string;

  /** Called once at startup. Returns tools to register and/or context to add. */
  init(
    agent: AgentContext,
    config?: Record<string, unknown>,
  ): Promise<PluginResult>;

  /** Called on shutdown for cleanup. */
  destroy?(): Promise<void>;
}

interface PluginResult {
  /** Additional tools the agent can use. */
  tools?: Tool[];
  /** Additional context to append to the system prompt. */
  systemPromptSuffix?: string;
}

interface AgentContext {
  /** The working directory. */
  cwd: string;
  /** Read-only access to the current session's messages. */
  messages: readonly Message[];
  /** The app data directory (~/.config/mini-coder/). */
  dataDir: string;
}
```

### Discovery

Plugins are declared in a config file (`~/.config/mini-coder/plugins.json` or similar). Each entry points to a module path or package name:

```json
{
  "plugins": [
    { "name": "mcp", "module": "@mini-coder/plugin-mcp", "config": { ... } },
    { "name": "custom", "module": "./my-plugin.ts" }
  ]
}
```

Built-in plugins (like MCP) can ship with mini-coder and be enabled by default.

### MCP as a plugin

MCP support is implemented as a plugin, not baked into the core. The MCP plugin:

- Connects to configured MCP servers (stdio or HTTP).
- Converts MCP tools into mini-coder tools, prefixed with the server name.
- Adds server descriptions to the system prompt.
- Manages server lifecycle (connect on init, disconnect on destroy).

This keeps the core agent loop clean — it only knows about `Tool[]`, regardless of where tools come from.

### Why plugins

- **Separation of concerns**: the agent loop doesn't know about MCP, OAuth flows, or any specific integration.
- **Optional complexity**: users who don't need MCP don't pay for it in startup time or code complexity.
- **Extensibility without bloat**: third-party tools, custom integrations, project-specific helpers — all through the same interface.

## Agent loop

The core runtime. This is what happens on each turn:

1. **User submits a message** — the input text (plus any embedded images or skill bodies from `/skill:name`) becomes a pi-ai `UserMessage`. It is appended to the session's message history and persisted to the DB.

2. **Build context** — construct a pi-ai `Context`: the system prompt (see [System prompt](#system-prompt)), the full message history, and the registered tool definitions (built-in + plugin tools). Git state in the session footer is refreshed before each turn.

3. **Stream to LLM** — call `streamSimple(model, context, options)` from pi-ai. Iterate over the event stream:
   - `text_delta` / `thinking_delta` → update the UI (stream markdown, show thinking if enabled).
   - `toolcall_end` → execute the tool call (see below), append the `ToolResultMessage` to history and DB.
   - `done` → append the `AssistantMessage` to history and DB. Update cumulative stats. If `stopReason` is `"toolUse"`, go to step 4. If `"stop"` or `"length"`, return to the input prompt.
   - `error` → display error in the log, return to the input prompt.

4. **Tool execution** — when the LLM requests tool calls:
   - Execute each tool call. For `shell`: run the command, capture output, truncate if needed. For `edit`: perform the replacement. For `readImage`: read and base64-encode the file. For plugin tools: delegate to the plugin.
   - Each result becomes a `ToolResultMessage` appended to history and DB (same turn number).
   - After all tool results are appended, loop back to step 2 (re-stream with the updated context).

5. **Interrupt** — if the user presses `Escape` during streaming:
   - Abort the stream via `AbortSignal`.
   - The partial `AssistantMessage` (with `stopReason: "aborted"`) is appended to history and DB as-is. This preserves context so the LLM knows what it was doing when interrupted.
   - Return to the input prompt. The user can continue the conversation or `/undo` the interrupted turn.

**No step limit** — the loop runs until the model stops (`stopReason: "stop"`) or the user interrupts. There is no maximum number of tool calls per turn.

**Context limit** — when the cumulative token count approaches `Model.contextWindow`, the agent must handle it before the provider rejects the request. Strategy: when context usage exceeds a threshold (e.g., 90%), trigger a compaction step — summarize the conversation history into a condensed form and replace the older messages. The summary is generated by the model itself (a separate, non-streamed call). The compacted history must preserve the system prompt prefix unchanged to maintain prompt caching. This is a critical edge case that needs careful implementation — the specifics (threshold, summary prompt, what to preserve) will be refined during development.

## Architecture

Flat `src/` directory. No workspaces, no internal packages. Files are grouped by concern but there's no enforced module boundary beyond what TypeScript imports naturally provide.

```
src/
  index.ts          — entry point, CLI setup
  agent.ts          — the core agent loop
  tools.ts          — shell and edit tool implementations
  skills.ts         — agentskills.io discovery, parsing, catalog
  prompt.ts         — system prompt construction (base + AGENTS.md + skills + plugins + git)
  session.ts        — SQLite session persistence
  plugins.ts        — plugin loader and lifecycle
  git.ts            — git state gathering
  ui.ts             — cel-tui UI (layout, rendering, state)
  types.ts          — shared types
```

This is suggestive, not prescriptive. Files may split or merge as the code evolves.

## System prompt

A single prompt, model-agnostic. Assembled at session start from static parts and dynamic context.

### Construction order

1. **Base instructions** (static) — the core prompt below.
2. **AGENTS.md content** — project-specific instructions, injected as-is.
3. **Skills catalog** — names + descriptions + paths in XML format.
4. **Plugin suffixes** — any `systemPromptSuffix` returned by plugins.
5. **Session metadata** — current date, working directory.

Prompt caching: the static prefix (1) should remain identical across turns. Dynamic sections (2–5) are appended and stable within a session, changing only on `/new` or CWD change.

The `readImage` tool is **not** mentioned in the base instructions — it is conditionally registered (only for vision-capable models) and the model discovers it through the tool definitions, not the prompt text. This avoids confusing models that don't have image support.

### Base instructions

```
You are mini-coder, a coding agent running in the user's terminal.

# Role

You are an autonomous, senior-level coding assistant. When the user gives a direction, proactively gather context, plan, implement, and verify without waiting for additional prompts at each step. Bias toward action: make reasonable assumptions and deliver working code rather than asking clarifying questions, unless you are genuinely blocked.

# Tools

You have these core tools:

- `shell` — run commands in the user's shell. Use this to explore the codebase (rg, find, ls, cat), run tests, build, git, and any other command. Prefer `rg` over `grep` for speed.
- `edit` — make exact-text replacements in files. Provide the file path, the exact text to find, and the replacement text. The old text must match exactly one location in the file. To create a new file, use an empty old text and the full file content as new text.

You may also have additional tools provided by plugins. Use them when they match the task.

Workflow: **inspect with shell → mutate with edit → verify with shell**.

# Code quality

- Conform to the codebase's existing conventions: patterns, naming, formatting, language idioms.
- Write correct, clear, minimal code. Don't over-engineer, don't add abstractions for hypothetical futures.
- Reuse before creating. Search for existing helpers before writing new ones.
- Tight error handling: no broad try/catch, no silent failures, no swallowed errors.
- Keep type safety. Avoid `any` casts. Use proper types and guards.
- Only add comments where the logic isn't self-evident.

# Editing discipline

- Read enough context before editing. Batch logical changes together rather than making many small edits.
- Never revert changes you didn't make unless explicitly asked.
- Never use destructive git commands (reset --hard, checkout --, clean -fd) unless the user requests it.
- Default to ASCII. Only use non-ASCII characters when the file already uses them or there's clear justification.

# Exploring the codebase

- Think first: before any tool call, decide all files and information you need.
- Batch reads: if you need multiple files, read them together in parallel rather than one at a time.
- Only make sequential calls when a later call genuinely depends on an earlier result.

# Communication

- Be concise. Friendly coding teammate tone.
- After making changes: lead with a quick explanation of what changed and why, then suggest logical next steps if any.
- Don't dump large file contents you've written — reference file paths.
- When suggesting multiple options, use numbered lists so the user can reply with a number.
- If asked for a review, focus on bugs, risks, regressions, and missing tests. Findings first, ordered by severity.

# Persistence

- Carry work through to completion within the current turn. Don't stop at analysis or partial fixes.
- If you encounter an error, diagnose and fix it rather than reporting it and stopping.
- Avoid excessive looping: if you're re-reading or re-editing the same files without progress, stop and ask the user.
```

### Dynamic sections

Appended after the base instructions:

**AGENTS.md** (when present):

```
# Project Context

Project-specific instructions and guidelines:

## <file-path>

<content>
```

**Skills catalog** (when skills are discovered):

```
The following skills provide specialized instructions for specific tasks.
Use the shell tool to read a skill's file when the task matches its description.
When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md) and use that absolute path in tool commands.

<available_skills>
  <skill>
    <name>...</name>
    <description>...</description>
    <location>...</location>
  </skill>
</available_skills>
```

**Session footer**:

```
Current date: YYYY-MM-DD
Current working directory: /path/to/cwd
Git: branch main | 3 staged, 1 modified, 2 untracked | +5 −2 vs origin/main
```

The git line is omitted when not inside a repository. Fields are omitted when empty (e.g., no staged files, no remote tracking). Gathered once at session start and refreshed each turn via fast git commands:

- `git rev-parse --show-toplevel` — repo root
- `git branch --show-current` — current branch
- `git status --porcelain` — staged, modified, untracked counts
- `git rev-list --left-right --count HEAD...@{upstream}` — ahead/behind remote

This gives the model the same situational awareness a developer gets from their shell prompt — which branch, whether the tree is dirty, and whether there's unpushed work.

### Design rationale

Key decisions informed by the Codex prompting guide and Claude prompting best practices:

- **Autonomy and persistence**: both guides emphasize that coding agents should bias toward action, persist through errors, and complete work end-to-end. The prompt explicitly states this.
- **Inspect → mutate → verify**: the Codex guide's recommended workflow. Makes the two-tool surface sufficient.
- **Batch reads**: both guides stress parallel tool calling. The prompt instructs the model to think first and batch.
- **No plan dumping**: the Codex guide notes that prompting for upfront plans can cause models to stop prematurely. We ask for action, not plans.
- **Edit discipline**: derived from Codex's editing constraints (don't revert others' changes, no destructive git, ASCII default).
- **Concise communication**: both guides recommend against verbose summaries. The prompt asks for brief explanations focused on what changed.
- **Model-agnostic**: no provider-specific instructions. Works across Anthropic, OpenAI, Google, and others. Uses XML tags for structure (well-understood by all major models).
- **Single prompt**: no branching based on model family. Complexity in the prompt is complexity we maintain.

## CLI UX

### Layout

Three zones, top to bottom:

```
┌──────────────────────────────────────────────┐
│                                              │
│  Conversation log                            │
│  (scrollable, flex: 1)                       │
│                                              │
│  ▶ User: fix the tests                       │
│                                              │
│  ▷ Agent: I'll check the test suite...       │
│    ┌─────────────────────────────┐           │
│    │ $ bun test                  │           │
│    │ 3 passed, 1 failed         │           │
│    └─────────────────────────────┘           │
│    Fixed the assertion in...                 │
│                                              │
├──────────────────────────────────────────────┤
│ > fix the remaining lint warnings            │
│   in the utils file too                      │
├──────────────────────────────────────────────┤
│ ~/src/mini-coder              main +3 ~1 ▲ 2 │
│ anthropic/sonnet-4 · med  in:1.2k out:0.8k 42% $0.03 │
└──────────────────────────────────────────────┘
```

cel-tui structure:

```ts
VStack({ height: "100%" }, [
  // Conversation log — takes all available space
  VStack({ flex: 1, overflow: "scroll", scrollbar: true }),
  Divider(),
  // Input area — intrinsic height, grows up to maxHeight
  HStack({ padding: { x: 1 } }, [
    Text(">"),
    TextInput({ flex: 1, maxHeight: 10 }),
  ]),
  Divider(),
  // Status bar — fixed 2 lines
  VStack({ height: 2 }, [
    HStack([Text(cwd), Spacer(), Text(gitStatus)]),
    HStack([Text(modelInfo), Spacer(), Text(usage)]),
  ]),
]);
```

### Status bar

Two lines, four corners:

```
~/src/mini-coder                                     main +3 ~1 ▲ 2
anthropic/sonnet-4 · med                       in:1.2k out:0.8k · 42% · $0.03
```

**Line 1 — location:**

- Left: CWD, abbreviated with `~` for home. Truncated from the left (`…/mini-coder`) on narrow terminals.
- Right: git branch, working tree counts (+ staged, ~ modified, ? untracked), ahead of remote (▲ N). Omitted outside a repo.

**Line 2 — session:**

- Left: `provider/model · effort`. Effort shown as `low`, `med`, `high`, `xhigh`.
- Right: `in:input out:output · context% · $cost`. All values are **cumulative for the session**.

Token counts use human-friendly units (1.2k, 45k, 1.2M). Context % is computed from cumulative tokens vs `Model.contextWindow`. Cost is a running sum of `AssistantMessage.usage.cost.total` across all messages in the session, accumulated by us (pi-ai tracks per-message only). Reset on `/new`, restored from DB on session resume.

### Conversation log

Scrollable area that shows the full conversation history. Stick-to-bottom by default (new content auto-scrolls), user can scroll up to review, scrolling back to bottom re-enables auto-scroll.

Message types and their rendering:

- **User messages**: prefixed with a role indicator and displayed as plain text.
- **Assistant messages**: streamed markdown rendered via cel-tui's `Markdown` component. Thinking/reasoning content is collapsible (hidden by default, toggled with `/reasoning`).
- **Tool calls — shell**: show the command, then stdout/stderr. Output is truncated in the UI (head + tail) with a visual marker. Full output viewable with `/verbose`.
- **Tool calls — edit**: show the file path and a brief summary (e.g., "edited 3 lines in `src/agent.ts`"). No full diff in the log.
- **Tool calls — plugin tools**: prefixed with plugin/tool name.
- **Errors**: one-line summary, styled distinctly.

While the agent is working, an inline spinner with an activity label ("thinking", "running shell", "editing") appears at the end of the log.

### Input area

Multi-line text input. Intrinsic height (1 line when empty, grows with content) up to `maxHeight: 10`, then scrolls internally. cel-tui's `TextInput` with `submitKey: "enter"` (Enter submits, Shift+Enter adds newlines).

The `>` prompt glyph is styled to indicate state:

- Ready for input (normal)
- Agent is working (dimmed/different color, input is not focused)

Supports:

- `Tab` for file path autocomplete.
- `/command` prefix for slash commands.
- `/skill:skill-name` prefix to inject a skill's body into the user message. The `/skill:name` prefix is stripped from the input and the skill's `SKILL.md` body is prepended to the user message content. The rest of the input becomes the user's instruction. Example: `/skill:code-review check the auth module` sends the code-review skill body + "check the auth module" as the user message.
- Image embedding: if the entire input (after trimming) is a file path ending in `.png`, `.jpg`, `.jpeg`, `.gif`, or `.webp`, and the file exists, it is embedded as `ImageContent` in the user message (base64-encoded). Only when the current model supports image input (`Model.input` includes `"image"`). If the model doesn't support images, or the file doesn't exist, or the input contains other text, the path is sent as plain text. This is intentionally simple — no inline detection within sentences.

### Key bindings

| Key           | Context       | Action                                            |
| ------------- | ------------- | ------------------------------------------------- |
| `Enter`       | Input focused | Submit message                                    |
| `Shift+Enter` | Input focused | Insert newline                                    |
| `Escape`      | Agent working | Interrupt current turn, preserve partial response |
| `Escape`      | Input focused | Unfocus input                                     |
| `Tab`         | Input focused | File path autocomplete                            |
| `Ctrl+C`      | Any           | Graceful exit                                     |
| `Ctrl+D`      | Input empty   | Graceful exit (EOF)                               |
| `Ctrl+Z`      | Any           | Suspend/background process                        |
| Mouse wheel   | Log area      | Scroll conversation history                       |

### Commands

| Command      | Description                                                                                                                                                                                                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/model`     | Interactive model selector (provider + model + effort). Switching models mid-session is allowed — pi-ai's context is model-agnostic. The `readImage` tool is re-evaluated (added/removed based on the new model's capabilities). The status bar updates immediately. The session record's `model` field is not updated (it reflects the initial choice). |
| `/session`   | Interactive session manager (list, resume, delete). Sessions scoped to CWD.                                                                                                                                                                                                                                                                              |
| `/new`       | Start a new session. Clears conversation, resets cost/token counters.                                                                                                                                                                                                                                                                                    |
| `/fork`      | Fork the current conversation into a new session. Copies the full message history, continues from here independently. The original session is preserved.                                                                                                                                                                                                 |
| `/undo`      | Remove the last turn from conversation history (the user message and all assistant/tool messages that followed). Context-only — does not revert filesystem changes.                                                                                                                                                                                      |
| `/reasoning` | Toggle display of model thinking/reasoning content in the log.                                                                                                                                                                                                                                                                                           |
| `/verbose`   | Toggle full output display (disables truncation in the UI).                                                                                                                                                                                                                                                                                              |
| `/login`     | Interactive OAuth login. Shows a selector with available OAuth providers and their login status (logged in / not logged in). Selecting a provider starts the browser-based OAuth flow. Uses pi-ai's OAuth registry. Credentials are persisted to the app data directory and used for provider discovery on subsequent launches.                          |
| `/logout`    | Interactive OAuth logout. Shows a selector with logged-in OAuth providers. Selecting one clears its saved credentials.                                                                                                                                                                                                                                   |
| `/help`      | List available commands, loaded AGENTS.md files, discovered skills, and active plugins.                                                                                                                                                                                                                                                                  |

Commands are discoverable via `/` + Tab autocomplete in the input area.

### Startup

On launch, mini-coder:

1. Discovers providers (env vars, OAuth tokens).
2. Loads AGENTS.md files, skills, plugins.
3. Starts a new session.
4. Renders the UI with an empty conversation log and the status bar populated.

No banner or splash screen. The status bar already shows all the context the user needs.

## Session persistence

Single SQLite file at `~/.config/mini-coder/mini-coder.db` via `bun:sqlite`.

### Schema

```sql
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,   -- nanoid or uuid
  cwd         TEXT NOT NULL,      -- working directory, indexed
  model       TEXT,               -- provider/model at creation
  effort      TEXT,               -- thinking effort level
  forked_from TEXT,               -- session id this was forked from, nullable
  created_at  INTEGER NOT NULL,   -- unix ms
  updated_at  INTEGER NOT NULL    -- unix ms, updated on each new message
);

CREATE INDEX idx_sessions_cwd ON sessions(cwd);

CREATE TABLE messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn        INTEGER NOT NULL,   -- groups a user message with its response cycle
  data        TEXT NOT NULL,      -- JSON-serialized pi-ai Message
  created_at  INTEGER NOT NULL    -- unix ms
);

CREATE INDEX idx_messages_session ON messages(session_id, turn);
```

### Design decisions

**Messages as JSON blobs**: pi-ai's `Message` type (UserMessage, AssistantMessage, ToolResultMessage) is already serializable. We store the full object as JSON in `data` rather than normalizing into columns. We never need to query by message content — we only load all messages for a session and replay them into a pi-ai `Context`.

**Turn grouping**: the `turn` column groups messages that belong to the same turn. A turn is: one user message + one or more assistant messages + any tool result messages from that agent loop. `/undo` deletes all messages with the highest `turn` value in the session. `/fork` copies all messages to a new session preserving turn numbers.

**Cumulative stats are computed, not stored**: token counts and cost for the status bar are computed by summing `usage` from assistant messages on session load (deserialize all messages, filter for `role: "assistant"`, sum their `usage` fields). The message count per session is small (hundreds), so this is fast. No separate counters to keep in sync. During an active session, a running in-memory accumulator is updated after each assistant message to avoid re-scanning.

**Turn number assignment**: when a user message is appended, its turn number is `MAX(turn) + 1` for the session (or 1 for the first message). All subsequent messages in the same agent loop (assistant responses, tool results) share that turn number. This is what makes `/undo` atomic — it deletes all messages with the highest turn.

**Model/effort on the session**: stored at creation for display in `/session` list. The user can change models mid-session via `/model`; the session record reflects the initial choice, individual messages record their actual model via pi-ai's `AssistantMessage.model`.

### Operations

| Operation      | SQL                                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New session    | `INSERT INTO sessions`                                                                                                                                   |
| Append message | `INSERT INTO messages` with current turn number, `UPDATE sessions SET updated_at`                                                                        |
| Undo           | `DELETE FROM messages WHERE session_id = ? AND turn = (SELECT MAX(turn) FROM messages WHERE session_id = ?)`                                             |
| Fork           | `INSERT INTO sessions` (new id, `forked_from` set), then `INSERT INTO messages SELECT ... FROM messages WHERE session_id = ?` (copy all, new session_id) |
| List sessions  | `SELECT * FROM sessions WHERE cwd = ? ORDER BY updated_at DESC`                                                                                          |
| Load session   | `SELECT data FROM messages WHERE session_id = ? ORDER BY id` → parse JSON → pi-ai `Message[]`                                                            |
| Delete session | `DELETE FROM sessions WHERE id = ?` (cascade deletes messages)                                                                                           |
