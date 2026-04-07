# mini-coder — spec

👾 Lightning fast coding agent for your terminal.

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
5. **Streaming end-to-end** — interaction between the UI and the agent is streamed wherever possible. User-visible progress during generation and tool use is essential, not optional polish.

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
- **Diffing**: `diff` (jsdiff) — `structuredPatch` for line-level unified diffs in edit tool output.

## Tools

Two built-in tools, plus a read-only image tool. Plugins may add more (see [Plugins](#plugins)).

### `shell`

Runs a command in the user's shell. Returns stdout, stderr, and exit code.

Implementation details:

- Large outputs are truncated as a safety guard against context explosion from bad or overly broad commands (for example, accidentally reading a huge file, binary, or unbounded command output). This guard applies to both very tall output (many lines) and very wide output (a few extremely long lines), and is not related to the user-configured verbose setting.
- The truncation threshold is configurable, tuned to keep useful output while staying well within context limits. This tool-level truncation is intentionally narrow in scope: it protects the model context from pathological output, not as a general-purpose presentation layer for every output-shaping concern.
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

- Walk from CWD toward the **scan root**, collecting every `AGENTS.md` found.
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

Plugins extend mini-coder itself, not just the prompt. They are the mechanism for optional capabilities that don't belong in the core — MCP servers, custom tools, integrations, alternate context-management strategies, UI/theme extensions, and other agent features.

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
  /** Partial theme override — merged on top of the default theme. */
  theme?: Partial<Theme>;
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

### Why plugins

- **Separation of concerns**: the agent loop doesn't know about specific integrations or optional behaviors — it only sees `Tool[]` and plugin-provided context/theme extensions.
- **Optional complexity**: capabilities are opt-in. Users only pay for what they use.
- **Extensibility without bloat**: third-party tools, custom integrations, project-specific helpers, and non-core agent features all go through the same interface.

## Agent loop

The core runtime. Streaming is the default behavior throughout the turn: user-visible state should update incrementally as the model emits text, thinking, and tool-call events, rather than waiting for whole responses to complete. This is what happens on each turn:

1. **User submits a message** — the input text (plus any embedded images or skill bodies from `/skill:name`) becomes a pi-ai `UserMessage`. It is appended to the session's message history, rendered in the UI immediately, and persisted to the DB.

2. **Build context** — construct a pi-ai `Context`: the system prompt (see [System prompt](#system-prompt)), the full message history, and the registered tool definitions (built-in + plugin tools). Git state in the session footer is refreshed at session start and after each turn.

3. **Stream to LLM** — call `streamSimple(model, context, options)` from pi-ai. Iterate over the event stream:
   - `text_delta` / `thinking_delta` / `toolcall_delta` → update the in-progress assistant message and the UI incrementally (stream markdown, show thinking if enabled, accumulate tool call arguments as they arrive).
   - `toolcall_end` → finalize the structured tool call in the in-progress `AssistantMessage`.
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

**Context limit** — mini-coder does not implement built-in context compaction. The status bar still estimates current context usage for the next request, but automatic history summarization is not a core feature. If compaction or summarization is added, it should be optional and plugin-provided rather than hardwired into the core, since users disagree about whether automatic compaction is desirable.

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
5. **Session footer** — current date, working directory, and git state when available.

Prompt caching: the static prefix (1) should remain identical across turns. AGENTS.md content, skills, and plugin suffixes are stable within a session, changing only on `/new` or CWD change. The session footer is refreshed as needed across turns so the date and git state stay current.

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
│                                                      │
│  ┌─────────────────────────────────────────────┐     │
│  │ fix the tests                               │     │  user: bg color
│  └─────────────────────────────────────────────┘     │
│                                                      │
│  I'll check the test suite first.                    │  agent: default bg
│                                                      │
│  │ $ bun test                                        │  tool: left border
│  │ 3 passed, 1 failed                                │  dimmed text
│  │ FAIL src/agent.test.ts > handles error            │
│  │ exit 1                                            │
│  │                                                   │
│  │ ~ src/agent.ts                                    │  edit: path + diff
│  │ -    expect(result).toBe("stop");                 │  red removed
│  │ +    expect(result).toBe("error");                │  green added
│  │                                                   │
│  Fixed the assertion. Tests pass now.                │
│                                                      │
────══════───────────────────────────────────────────  animated divider
 fix the remaining lint warnings                       │  input: no prefix
 in the utils file too_                                │
 [ anthropic/sonnet-4 · med ] [ ~/src/mini-coder ] [ main +3 ~1 ▲ 2 ] [ in:1.2k out:0.8k · 42%/200k · $0.03 ] │  status pills
```

cel-tui structure:

```ts
VStack({ height: "100%" }, [
  // Conversation log — takes all available space
  VStack({ flex: 1, overflow: "scroll" }),
  // Top divider — animated scanning pulse when agent is working
  Divider(),
  // Input area — intrinsic height, no prompt prefix; starts at 2 lines
  TextInput({ minHeight: 2, maxHeight: 10, padding: { x: 1 } }),
  // Status pills — fixed 1 line, backgrounds only behind the text
  HStack({ height: 1, padding: { x: 1 } }, [
    statusPill(modelInfo, theme.statusPrimaryBg),
    statusPill(cwd, theme.statusSecondaryBg),
    Spacer(),
    gitStatus && statusPill(gitStatus, theme.statusSecondaryBg),
    statusPill(usage, theme.statusPrimaryBg),
  ]),
]);
```

### Theme

All UI colors are defined in a single `Theme` object. The UI never hardcodes colors — it reads from the active theme. Plugins can return a `Partial<Theme>` in their `PluginResult` to override any color. Multiple plugin overrides are merged left-to-right (last wins).

```ts
interface Theme {
  /** User message background. */
  userMsgBg: Color | undefined;
  /** Muted informational text, placeholders, and helper copy. */
  mutedText: Color | undefined;
  /** Primary accent for important labels and interactive highlights. */
  accentText: Color | undefined;
  /** Secondary accent for supplementary labels like git status. */
  secondaryAccentText: Color | undefined;
  /** Tool output left border and text. */
  toolBorder: Color | undefined;
  toolText: Color | undefined;
  /** Diff colors in edit tool output. */
  diffAdded: Color | undefined;
  diffRemoved: Color | undefined;
  /** Divider line color (idle state). */
  divider: Color | undefined;
  /** Divider scanning pulse highlight color (active state). */
  dividerPulse: Color | undefined;
  /** Status pill foreground. */
  statusText: Color | undefined;
  /** Primary status pill background (outer pills: model/effort + usage/context/cost). */
  statusPrimaryBg: Color | undefined;
  /** Secondary status pill background (inner pills: CWD + git). */
  statusSecondaryBg: Color | undefined;
  /** Error text. */
  error: Color | undefined;
  /** Overlay modal background. */
  overlayBg: Color | undefined;
}
```

The default theme uses the full ANSI 16-color terminal palette where semantic accents or pill styling benefit from it, including bright variants (`color08`-`color15`) rather than restricting itself to the base 8 colors. Semantic colors should still map sensibly (for example, greens for additions/success and reds for removals/errors), but status pill styling may draw from the wider ANSI 16 range to create restrained outer/inner separation. Status pill backgrounds are applied only behind the text and padding, never across the full width of the status area. Default status colors must remain legible on both light and dark terminals. Theme values are cel-tui colors; `undefined` means "use the terminal default".

### Status bar

One line, two-sided, rendered as compact padded pills rather than a full-width footer band:

```
[ anthropic/sonnet-4 · med ] [ ~/src/mini-coder ]            [ main +3 ~1 ▲ 2 ] [ in:1.2k out:0.8k · 42.0%/200k · $0.03 ]
```

- Background is applied only behind each pill's text + padding; there is no bottom divider below the input and no full-width colored block.
- The outer pills (`model/effort` on the left, `usage/context/cost` on the right) use `statusPrimaryBg`.
- The inner pills (`cwd` on the left, `git` on the right) use `statusSecondaryBg`.
- All status pill text uses `statusText`, chosen to remain legible against both pill backgrounds on light and dark terminals.
- The git pill is omitted outside a repo, preserving the current omission behavior.

**Left side:**

- Outer-left: `provider/model · effort`. Effort shown as `low`, `med`, `high`, `xhigh`.
- Inner-left: CWD, abbreviated with `~` for home. Truncated from the left (`…/mini-coder`) on narrow terminals.

**Right side:**

- Inner-right: git branch, working tree counts (+ staged, ~ modified, ? untracked), ahead of remote (▲ N). Omitted outside a repo.
- Outer-right: `in:input out:output · context%/window · $cost`. `in`, `out`, and `$cost` are **cumulative for the session**. `context%/window` shows the **estimated current context usage for the next model request** as a percentage of the active model's context window.

Token counts use human-friendly units (1.2k, 45k, 1.2M). Context usage is estimated from the current model-visible conversation, not just the last assistant message. Use the most recent valid assistant `usage` as an anchor (`totalTokens` when present, otherwise `input + output + cacheRead + cacheWrite`) and add heuristic estimates for any later messages. If no assistant `usage` exists yet, estimate the full current model-visible history heuristically. UI-only messages are excluded from this estimate.

### Conversation log

Scrollable area that shows the full conversation history. Stick-to-bottom by default (new content auto-scrolls), user can scroll up to review, scrolling back to bottom re-enables auto-scroll. Conversation updates are streamed into this log as they happen; the UI should not wait for a completed turn before showing progress.

Message types and their rendering:

- **User messages**: displayed as plain text with a subtle background color to distinguish them from agent responses. No prefix or role indicator.
- **Assistant messages**: streamed markdown rendered via cel-tui's `Markdown` component on the default background. Thinking/reasoning content is collapsible (shown or hidden according to the user's persisted `/reasoning` preference; defaults to shown when no setting exists).
- **Tool calls — shell**: rendered with a left border (`│`) and dimmed foreground. Shows the command (`$ command`) and the tool output. When `/verbose` is off, shell output is previewed as the first 20 lines followed by `And X lines more` when additional lines exist. When `/verbose` is on, the shell block expands to the full stored tool result. This is a UI-only display choice over the stored result; it is separate from the shell tool's own safety truncation for pathological output. Exit code display is intended but not implemented yet.
- **Tool calls — edit**: rendered with a left border (`│`) and dimmed foreground. Shows the file path and a unified diff of the change (added lines in green, removed in red). When `/verbose` is off, the diff preview shows the first 20 diff lines followed by `And X lines more` when additional lines exist. When `/verbose` is on, the diff expands to the full stored tool result. This is a UI-only display choice. Uses the `diff` package (`structuredPatch`) for line-level diffing.
- **Tool calls — plugin tools**: rendered with a left border, prefixed with plugin/tool name.
- **UI messages**: internal app messages such as `/help` output, OAuth progress, and other session-local notices. They are rendered in the conversation log, persisted with the session, excluded from model context, and do not participate in conversational turn numbering.
- **Errors**: one-line summary, styled distinctly.

While the agent is working, the top divider (above the input area) animates with a scanning pulse — a bright and colored (be creative) segment sweeping across the dimmed divider line. The animation starts when a turn begins and stops when the turn ends (done, error, or aborted). No per-activity state tracking.

### Input area

Multi-line text input with no prompt prefix — the blinking cursor is the affordance. Intrinsic height starts at 2 lines when empty (`minHeight: 2`), grows with content up to `maxHeight: 10`, then scrolls internally. Enter submits, Shift+Enter adds newlines (via cel-tui's `TextInput` `onKeyPress` pattern).

Supports:

- `Tab` for file path autocomplete.
- `/command` prefix for slash commands.
- `/skill:skill-name` prefix to inject a skill's body into the user message. The `/skill:name` prefix is stripped from the input and the skill's `SKILL.md` body is prepended to the user message content. The rest of the input becomes the user's instruction. Example: `/skill:code-review check the auth module` sends the code-review skill body + "check the auth module" as the user message.
- Image embedding: if we autocomplete a file path ending in `.png`, `.jpg`, `.jpeg`, `.gif`, or `.webp`, and the file exists, it is embedded as `ImageContent` in the user message (base64-encoded). Only when the current model supports image input (`Model.input` includes `"image"`). If the model doesn't support images, or the file doesn't exist, or the input contains other text, the path is sent as plain text. This is intentionally simple — no inline detection within sentences.

### Key bindings

| Key           | Context       | Action                                            |
| ------------- | ------------- | ------------------------------------------------- |
| `Enter`       | Input focused | Submit message                                    |
| `Shift+Enter` | Input focused | Insert newline                                    |
| `Escape`      | Agent working | Interrupt current turn, preserve partial response |
| `Tab`         | Input focused | File path autocomplete                            |
| `Ctrl+C`      | Any           | Graceful exit                                     |
| `Ctrl+D`      | Input empty   | Graceful exit (EOF)                               |
| `Ctrl+Z`      | Any           | Suspend/background process                        |
| Mouse wheel   | Log area      | Scroll conversation history                       |

### Commands

| Command      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/model`     | Interactive model selector. Switching models mid-session is allowed — pi-ai's context is model-agnostic. The `readImage` tool is re-evaluated (added/removed based on the new model's capabilities). The status bar updates immediately, and the selected model is persisted immediately as the user's global default. The session record's `model` field is not updated (it reflects the initial choice).                                            |
| `/session`   | Interactive session manager (list, resume). Sessions scoped to CWD.                                                                                                                                                                                                                                                                                                                                                                                   |
| `/new`       | Start a new session. Clears conversation, resets cost/token counters.                                                                                                                                                                                                                                                                                                                                                                                 |
| `/fork`      | Fork the current conversation into a new session. Copies the full message history, continues from here independently. The original session is preserved.                                                                                                                                                                                                                                                                                              |
| `/undo`      | Remove the last conversational turn from history: the most recent user message and all assistant/tool messages that followed in that turn. Persisted UI messages are not part of turns and are not removed by `/undo`. Context-only — does not revert filesystem changes.                                                                                                                                                                             |
| `/reasoning` | Toggle display of model thinking/reasoning content in the log. The new on/off state is persisted immediately and restored on launch. When no setting exists yet, reasoning defaults to shown.                                                                                                                                                                                                                                                         |
| `/verbose`   | Toggle full shell-output and edit-diff display in the UI. When off, those tool blocks show a concise preview (first 20 lines plus `And X lines more` when applicable). When on, they expand to the full stored tool result. This setting only affects UI rendering; it does not control tool-level safety truncation. The new on/off state is persisted immediately and restored on launch. When no setting exists yet, verbose mode defaults to off. |
| `/login`     | Interactive OAuth login. Shows a selector with available OAuth providers and their login status (logged in / not logged in). Selecting a provider starts the browser-based OAuth flow. Uses pi-ai's OAuth registry. Credentials are persisted to the app data directory and used for provider discovery on subsequent launches.                                                                                                                       |
| `/logout`    | Interactive OAuth logout. Shows a selector with logged-in OAuth providers. Selecting one clears its saved credentials.                                                                                                                                                                                                                                                                                                                                |
| `/effort`    | Interactive effort selector. Shows the four reasoning levels (`low`, `med`, `high`, `xhigh`) with the current level highlighted. Updates the status bar immediately, and the selected effort is persisted immediately as the user's global default. The session record's `effort` field is not updated (it reflects the initial choice, like `/model`).                                                                                               |
| `/help`      | List available commands, including the current on/off state of `/reasoning` and `/verbose`, plus loaded AGENTS.md files, discovered skills, and active plugins.                                                                                                                                                                                                                                                                                       |

Commands are discoverable when the input starts with `/`: pressing `Tab` in that state switches from file-path autocomplete to interactive command select/filter.

### Startup

On launch, mini-coder:

1. Discovers providers (env vars, OAuth tokens).
2. Loads user settings from `~/.config/mini-coder/settings.json`.
3. Selects the startup model, effort, reasoning visibility, and verbose mode from those settings when available.
   - `defaultModel`: if the saved provider/model is currently available, use it; otherwise fall back to the first available model for this launch.
   - `defaultEffort`: if valid, use it; otherwise fall back to `medium`.
   - `showReasoning`: if present, use it; otherwise fall back to `true`.
   - `verbose`: if present, use it; otherwise fall back to `false`.
4. Loads AGENTS.md files, skills, plugins.
5. Renders the UI with an empty conversation log and the status bar populated.
6. Starts a new session when the user sends a message (no 0-message sessions in the DB).

No banner or splash screen. The status bar already shows all the context the user needs.

## User settings persistence

mini-coder persists global user defaults in `~/.config/mini-coder/settings.json`.

### Stored settings

```json
{
  "defaultModel": "anthropic/claude-sonnet-4",
  "defaultEffort": "medium",
  "showReasoning": true,
  "verbose": false
}
```

### Semantics

- Settings are **global to the user**, not scoped per project, repository, or session.
- `/model`, `/effort`, `/reasoning`, and `/verbose` persist their new values immediately when changed.
- If `defaultModel` is saved but unavailable at startup (for example, missing credentials), mini-coder keeps the saved preference unchanged and uses a runtime fallback model for that launch.
- Invalid or missing settings file content is treated as "no saved settings" rather than a fatal startup error.
- `/new`, `/fork`, and `/session` do not modify global settings.
- Session records remain historical: their `model` and `effort` fields reflect the values active when that session was created, not the current global defaults.

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
  turn        INTEGER,            -- conversational turn number; NULL for UI-only messages
  data        TEXT NOT NULL,      -- JSON-serialized persisted message (pi-ai Message or internal UI message)
  created_at  INTEGER NOT NULL    -- unix ms
);

CREATE INDEX idx_messages_session ON messages(session_id, turn);
```

### Design decisions

**Messages as JSON blobs**: pi-ai's `Message` type (UserMessage, AssistantMessage, ToolResultMessage) is already serializable, and we also persist internal UI-only log entries in the same table. We store the full object as JSON in `data` rather than normalizing into columns. Session load returns the complete chronological log; model context construction filters out UI-only messages before replaying the remaining pi-ai messages into a pi-ai `Context`.

**Turn grouping**: the `turn` column groups only conversational messages. A turn is: one user message + one or more assistant messages + any tool result messages from that agent loop. Persisted UI messages are stored alongside them but have `turn = NULL`, so they remain visible in session history without becoming part of `/undo`. `/fork` copies all persisted messages to a new session, preserving conversational turn numbers and UI messages as-is.

**Cumulative stats are computed, not stored**: the status bar's cumulative `in`, `out`, and `$cost` values are computed by summing `usage` from assistant messages on session load (deserialize all messages, filter for `role: "assistant"`, sum their `usage` fields). The message count per session is small (hundreds), so this is fast. No separate counters to keep in sync. During an active session, a running in-memory accumulator is updated after each assistant message to avoid re-scanning. `context%/window` is separate: it is estimated from the current model-visible history for the next request rather than stored cumulatively.

**Turn number assignment**: when a user message is appended, its turn number is `MAX(turn) + 1` for the session (or 1 for the first conversational message). All subsequent assistant responses and tool results in the same agent loop share that turn number. UI-only messages do not receive a turn number. This is what makes `/undo` atomic for conversation history without removing system notices that are still true after the undo.

**Model/effort on the session**: stored at creation for display in `/session` list. The user can change models and effort mid-session via `/model` and `/effort`; those commands update the current in-memory state and global user settings, but the session record still reflects the initial values for that session. Individual assistant messages record their actual model via pi-ai's `AssistantMessage.model`.

**Session truncation**: sessions are truncated per cwd to keep only the 20 most recently updated sessions (`updated_at DESC`), deleting older sessions and their messages via cascade.

### Operations

| Operation      | SQL                                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New session    | `INSERT INTO sessions`                                                                                                                                   |
| Append message | `INSERT INTO messages` with the current conversational turn number (or `NULL` for UI-only messages), `UPDATE sessions SET updated_at`                    |
| Undo           | `DELETE FROM messages WHERE session_id = ? AND turn = (SELECT MAX(turn) FROM messages WHERE session_id = ?)`                                             |
| Fork           | `INSERT INTO sessions` (new id, `forked_from` set), then `INSERT INTO messages SELECT ... FROM messages WHERE session_id = ?` (copy all, new session_id) |
| List sessions  | `SELECT * FROM sessions WHERE cwd = ? ORDER BY updated_at DESC`                                                                                          |
| Load session   | `SELECT data FROM messages WHERE session_id = ? ORDER BY id` → parse JSON → persisted message log (`pi-ai Message[]` + internal UI messages)             |
| Delete session | `DELETE FROM sessions WHERE id = ?` (cascade deletes messages)                                                                                           |
