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
- **Components**: `SyntaxHighlight` (streaming-aware), `Button`, `Select`, `Divider`, `Spacer`.
- **Input**: Kitty keyboard protocol, proper key handling, mouse scroll/click.
- **Rendering**: Differential cell-buffer rendering, synchronized output (no flicker).
- **Scroll**: Controlled/uncontrolled scroll with stick-to-bottom support.
- **Focus**: Tab/Shift+Tab traversal, controlled/uncontrolled focus.

The chat example (`cel-tui/examples/chat.ts`) is essentially a skeleton of our UI. TextInput, scroll, and streaming updates — it's all there.

This replaces: `yoctocolors`, `yoctomarkdown`, `yoctoselect`, and all our custom widget/rendering code.

### Other dependencies

- **Runtime**: Bun — for runtime, bundling, testing, and `bun:sqlite`.
- **Schema validation**: TypeBox (re-exported from pi-ai) for tool schemas.

## Tools

Six built-in tools, plus a conditional read-only image tool. Plugins may add more (see [Plugins](#plugins)).

### `shell`

Runs a command in the user's shell. Returns stdout, stderr, and exit code. Use it to explore the codebase, read tests/verifiers/examples, inspect required outputs, and run targeted checks, builds, or git commands. Commands mutate the real working directory, so verification outputs should go to temporary paths or be cleaned up before finishing.

Implementation details:

- Large outputs are truncated as a safety guard against context explosion from bad or overly broad commands (for example, accidentally reading a huge file, binary, or unbounded command output). This guard applies to both very tall output (many lines) and very wide output (a few extremely long lines), and is not related to the user-configured verbose setting.
- The truncation threshold is configurable, tuned to keep useful output while staying well within context limits. This tool-level truncation is intentionally narrow in scope: it protects the model context from pathological output, not as a general-purpose presentation layer for every output-shaping concern.
- Commands run via `$SHELL -c "<command>"` (falling back to `/bin/sh` if `$SHELL` is unset) with the CWD set to the session's working directory.
- Verification commands that produce build artifacts should prefer temporary output paths or clean up generated files before the agent finishes.
- Before execution, the harness may apply a small set of silent, lossless compatibility normalizations for common model-authored shell mistakes when the intended command is unambiguous (for example, moving a heredoc trailer's `|`, `&&`, or `>` continuation back onto the heredoc start line, or rewriting `printf '--- ...'` to `printf -- '--- ...'` when the format string begins with `-`).
- Compatibility normalization is best-effort and intentionally narrow. If a rewrite is ambiguous or the normalization step itself fails, the raw command is executed unchanged.
- Timeout: no default timeout. The user can interrupt via `Escape`.

### `read`

Reads a UTF-8 text file from disk, optionally by line window. Use it for reading file contents instead of shelling out to `cat`, `sed`, `head`, or `tail`.

Implementation details:

- Takes `path`, optional `offset`, and optional `limit`.
- `path` may be absolute or relative to the session CWD.
- `offset` and `limit` are line-based.
- Returns the requested slice as plain text, plus a clear continuation hint when more content remains (for example `use offset=...`).
- Any tool-level truncation or continuation behavior is part of the tool contract and stays separate from the UI's `/verbose` rendering.

### `grep`

Searches file contents using ripgrep-style options and returns structured matches. Use it for content search instead of shelling out to `grep` / `rg` when the goal is to find relevant files or matching lines.

Implementation details:

- Takes `pattern`, optional `path`, optional `glob`, optional `ignoreCase`, optional `literal`, optional `context`, and optional `limit`.
- `path` defaults to the session CWD when omitted. Relative `path` values are resolved against the session CWD.
- Executes ripgrep in JSON mode under the hood (`rg --json`) so matches, context lines, and summary data can be parsed deterministically.
- Returns structured match data, plus clear continuation behavior when the result set is capped.
- Any tool-level truncation or continuation behavior is part of the tool contract and stays separate from the UI's `/verbose` rendering.

### `edit`

Exact-text replacement in a single file. Use it to write the exact file content the task requires.

Implementation details:

- Takes a file path (absolute, or relative to the session CWD), the old text to find, and the new text to replace it with.
- The replacement text is inserted literally. Replacement markers such as `$$`, `$&`, `$'`, and the JS prefix marker ($ followed by a backtick) are not expanded.
- Fails deterministically if the old text is not found or matches multiple locations. Returns a descriptive error with nearby similar snippets or match locations so the model can self-correct.
- Create new files by passing empty old text and the full file content as new text. Parent directories are created automatically.
- Returns a confirmation or error message — no diff output (the agent already knows what it wrote).
- Encoding: reads and writes UTF-8. Preserves the file's existing line endings.

### `todoWrite`

Creates or updates the session todo list incrementally. Use it to track multi-step or non-trivial work, keep progress visible, and mark tasks complete explicitly.

Implementation details:

- Takes a `todos` array. Each item must include `content` and `status`.
- `content` is the exact matching key. If an item with the same content already exists, its status is updated in place. Otherwise a new item is appended.
- Allowed statuses: `pending`, `in_progress`, `completed`, `cancelled`.
- `cancelled` removes the matching item entirely.
- Items omitted from a call remain unchanged.
- Successful results return the full current todo-list snapshot in insertion order. Surviving items keep their relative order; newly added items are appended.
- Todo content must not be empty or whitespace-only and must stay within a small fixed length limit.
- Todo state is session-local and derived from the latest successful todo snapshot persisted in message history, so `/undo`, `/fork`, session reload, and session switching all restore the correct list automatically.

### `todoRead`

Returns the current session todo list.

Implementation details:

- Takes no arguments.
- Returns the full current todo-list snapshot, which may be empty.
- The returned snapshot uses the same shape as `todoWrite` success results.

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

Contents are appended to the system prompt after the core prompt as project-specific context.

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

The core runtime. Streaming is the default behavior throughout the turn: user-visible state should update incrementally as the model emits text, thinking, and tool-call events, rather than waiting for whole responses to complete. This is what happens while the agent is active:

1. **User submits a message** — the input text (plus any embedded images or skill bodies from `/skill:name`) becomes a pi-ai `UserMessage`. It is appended to the session's message history, rendered in the UI immediately, and persisted to the DB.

2. **Build context** — construct a pi-ai `Context`: the system prompt (see [System prompt](#system-prompt)), the full message history, and the registered tool definitions (built-in + plugin tools). The prompt context snapshot is loaded once at startup or another explicit reload boundary and then reused across turns so provider prompt caching stays effective. It is refreshed only at boundaries such as `/new` or CWD change.

3. **Stream to LLM** — call `streamSimple(model, context, options)` from pi-ai. Iterate over the event stream:
   - `text_delta` / `thinking_delta` / `toolcall_delta` → update the in-progress assistant message and the UI incrementally (stream raw markdown text, show thinking if enabled, accumulate tool call arguments as they arrive).
   - `toolcall_end` → finalize the structured tool call in the in-progress `AssistantMessage`.
   - `done` → append the `AssistantMessage` to history and DB. Update cumulative stats. If `stopReason` is `"toolUse"`, go to step 4. If `"stop"` or `"length"` and queued steering messages exist, go to step 6. If `"stop"` or `"length"` and incomplete todo items remain, go to step 5. Otherwise return to the input prompt.
   - `error` → display error in the log, return to the input prompt.

4. **Tool execution** — when the LLM requests tool calls:
   - Execute each tool call. For `shell`: run the command, capture output, truncate if needed. For `read`: read the requested file slice and include continuation guidance when needed. For `grep`: run the structured ripgrep search and return parsed match data. For `edit`: perform the replacement. For `todoWrite`: apply the incremental todo changes and return the full current list. For `todoRead`: return the full current list. For `readImage`: read and base64-encode the file. For plugin tools: delegate to the plugin.
   - Each result becomes a `ToolResultMessage` appended to history and DB (same turn number).
   - After all tool results are appended, if queued steering messages exist go to step 6; otherwise loop back to step 2 (re-stream with the updated context).

5. **Todo reminders** — when the assistant tries to stop while incomplete todo items still exist:
   - Inject a model-visible reminder listing the current `pending` and `in_progress` items as a synthetic user message whose content is wrapped in `<system_reminder>...</system_reminder>`, then loop back to step 2.
   - Reminders are ephemeral: they are included in model context for the follow-up request but are not rendered in the conversation pane and are not persisted to the session DB.
   - If the exact same incomplete-todo set was already reminded during the current run, do not inject a duplicate reminder. In that case the turn ends normally instead of looping forever.

6. **Steering messages** — if the user submits a model-visible message while an active run is already in progress, mini-coder queues it instead of dropping it or interrupting the current work.
   - Steering messages are consumed FIFO at the next model-request boundary: after the current assistant message is finalized and after any tool calls already requested by that assistant message have completed and their tool results have been appended.
   - When consumed, each steering message is appended to history and DB as a normal `UserMessage`, starting a new conversational turn.
   - After appending the next queued steering message, loop back to step 2 so the next `streamSimple(...)` call sees the updated history.
   - Submitting a steering message does not abort the current stream or running tool. Use `Escape` to interrupt immediately.

7. **Interrupt** — if the user presses `Escape` during streaming with no overlay open:
   - Abort the stream via `AbortSignal`.
   - The partial `AssistantMessage` (with `stopReason: "aborted"`) is appended to history and DB as-is. This preserves context so the LLM knows what it was doing when interrupted.
   - Return to the input prompt with focus on the input. The user can continue the conversation or `/undo` the interrupted turn.

   If an overlay is open instead, that first `Escape` dismisses the overlay, leaves the current draft unchanged, and returns focus to the input without interrupting the turn.

**No step limit** — the loop runs until the model stops (`stopReason: "stop"`) or the user interrupts. There is no maximum number of tool calls per turn.

**Context limit** — mini-coder does not implement built-in context compaction. The status bar still estimates current context usage for the next request, but automatic history summarization is not a core feature. If compaction or summarization is added, it should be optional and plugin-provided rather than hardwired into the core, since users disagree about whether automatic compaction is desirable.

## Architecture

Flat `src/` directory. No workspaces, no internal packages. Files are grouped by concern but there's no enforced module boundary beyond what TypeScript imports naturally provide.

```
src/
  index.ts          — entry point, CLI setup
  agent.ts          — the core agent loop
  tools.ts          — built-in tool implementations
  skills.ts         — agentskills.io discovery, parsing, catalog
  prompt.ts         — system prompt construction (core prompt + AGENTS.md + skills + plugins + environment)
  session.ts        — SQLite session persistence
  plugins.ts        — plugin loader and lifecycle
  git.ts            — git state gathering
  ui.ts             — cel-tui UI (layout, rendering, state)
  types.ts          — shared types
```

This is suggestive, not prescriptive. Files may split or merge as the code evolves.

## System prompt

A single prompt, model-agnostic. Assembled from a static core prompt plus prompt context captured at startup or another explicit reload boundary.

### Prompt template

The prompt is a single block of text. The environment block lives near the top of that prompt, not as a separate header or footer.

```
You are mini-coder, the best software engineer assistant agent in the world.

The current environment is:
- LLM in use: anthropic/claude-sonnet-4
- OS: linux
- Current working directory: /path/to/cwd
- Git: branch main | 3 staged, 1 modified, 2 untracked | +5 −2 vs origin/main
- Shell: bash. Use `command -v <name>` to check what is available to you; do not assume environment support.
- Read: Read a text file from disk with offset/limit support.
- Grep: Search file contents with ripgrep-style options and structured results.
- Edit: Safe exact-text replacement in a single file.
- Read Image: Read an image from disk.

## Core working style:

- Be concise, direct, and useful.
- Use a casual, solution-oriented technical tone. Avoid fluff and performative apologies.
- When the user gives a clear command, do it without adding extra work they did not ask for.
- Prefer the minimal implementation that satisfies the request.
- Use YAGNI. Avoid speculative abstractions, future-proofing, and unnecessary compatibility shims.
- Preserve working behavior where possible. Prefer targeted fixes over rewrites.
- Be thorough, use fresh eyes and internal analysis before taking action.
- Make informed decisions based on the available information and best practices.
- Always verify the result of your actions.

### Using the shell toll:

- Always execute shell commands in non-interactive mode.
- Use the appropriate commands and package managers for the specified operating system.
- Don't assume environment supports all commands, check before using.
- Avoid destructive commands that can discard changes or overide edits.

### Choosing tools:

- Prefer `read` for reading file contents instead of `cat`, `sed`, `head`, or `tail`.
- Prefer `grep` for content search instead of raw `grep` / `rg`.
- Use shell `ls` and `fd` for lightweight exploration when you just need to inspect directories or discover candidate files.

### Working with code:

- Describe changes before implementing them
- Prefer boring dependable solutions over clever ones
- Avoid creating extra files, systems or documentation outside of what was asked.
- Check requirements, and plan your changes before editting code.
- Implement the necessary changes, following good practices and propper error handling.
- Always verify your changes using compilation, testing, and manual verification when possible.
- When verifying with build or test commands, avoid leaving generated binaries or scratch artifacts in the requested output location; use temporary paths or remove them before finishing.
- Do not leave helpers, test, or any other form of temporary files, cleanup after yourself and leave no trace.

### Task management

- Use `todoWrite` proactively for multi-step or non-trivial tasks.
- Capture new requirements in the todo list as soon as you understand them.
- Use `todoRead` when you need to inspect the current list before updating it or when the user asks for the current plan/status.
- Keep the todo list up-to-date above all; mark tasks `in_progress` before starting them and `completed` as soon as verification succeeds.
- A todo item is only complete if the requested work is actually finished and verified to the degree the task requires.
- Use `cancelled` to remove tasks that are no longer relevant.
- Skip todo tools for single trivial tasks and purely conversational/informational requests.
- You have the option to delegate tasks to copies of yourself with `mc -p "subtask prompt"` in the shell.
- Delegate when you are orchestarting a large to-do/plan execution.
```

AGENTS.md content, skills catalog, and plugin suffixes are appended after this core prompt in that order.

**AGENTS.md** (when present):

```
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

Environment block notes:

- The git line is omitted when not inside a repository.
- Empty git fields are omitted.
- The `Read Image` line is omitted when the active model does not support image input.
- The OS value is normalized to `linux`, `mac`, or `docker`.
- The static core prompt text should remain identical across turns.
- AGENTS.md content, skills, plugin suffixes, and the git snapshot are stable within a session, changing only on `/new` or CWD change.
- Rebuilding the prompt for later turns must reuse that same session-start snapshot so provider prompt caching keeps working.

Git state is gathered when the session prompt context is loaded (startup, `/new`, or CWD change), not after each turn, via fast git commands:

- `git rev-parse --show-toplevel` — repo root
- `git branch --show-current` — current branch
- `git status --porcelain` — staged, modified, untracked counts
- `git rev-list --left-right --count HEAD...@{upstream}` — ahead/behind remote

This gives the model the same situational awareness a developer gets from their shell prompt — which model is active, which branch it is on, whether the tree is dirty, what shell it is using, and whether there's unpushed work.

### Design rationale

Key decisions informed by the Codex prompting guide and Claude prompting best practices:

- **Environment-first grounding**: model, OS, cwd, git state, shell, and conditional vision capability are disclosed near the top of the prompt so the agent starts from concrete local context.
- **Minimality over flourish**: the prompt emphasizes concise, direct help, discourages extra work the user did not ask for, and explicitly calls for the smallest implementation that satisfies the request.
- **Targeted changes over rewrites**: the prompt tells the agent to preserve working behavior where possible, prefer targeted fixes, and avoid speculative abstractions.
- **Operational discipline**: separate sections for shell use, code changes, and task management keep the prompt easy to scan while reinforcing non-interactive shell usage, environment checks, and cleanup expectations.
- **Verification and delegation**: the prompt explicitly requires verification, requires a `/tmp` to-do list, and reminds the agent it can delegate subtasks with `mc -p` when that helps.
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
│  │ shell -> bun test                                 │  tool call
│  │ shell <-                                          │  tool result
│  │ 3 passed, 1 failed                                │  dimmed text
│  │ FAIL src/agent.test.ts > handles error            │
│  │ exit 1                                            │
│  │                                                   │
│  │ edit ->                                           │  edit preview
│  │ src/agent.ts                                      │
│  │   expect(result).toBe("error");                  │
│  │                                                   │
│  │ edit <-                                           │  compact result
│  │ ~ src/agent.ts                                    │
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
    statusPill(modelInfo, effortTone(theme, effort)),
    statusPill(cwd, theme.statusSecondary),
    Spacer(),
    gitStatus && statusPill(gitStatus, theme.statusSecondary),
    statusPill(usage, contextTone(theme, contextPct)),
  ]),
]);
```

### Theme

All UI colors are defined in a single `Theme` object. The UI never hardcodes colors — it reads from the active theme. Plugins can return a `Partial<Theme>` in their `PluginResult` to override any color. Multiple plugin overrides are merged left-to-right (last wins).

```ts
interface StatusTone {
  /** Pill foreground. */
  fg: Color | undefined;
  /** Pill background. */
  bg: Color | undefined;
}

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
  /** Divider line color (idle state). */
  divider: Color | undefined;
  /** Divider scanning pulse highlight color (active state). */
  dividerPulse: Color | undefined;
  /** Neutral status pill tone for the inner CWD/git pills. */
  statusSecondary: StatusTone;
  /** Model/effort pill tones from low/cold to xhigh/warm. */
  statusEffortScale: [StatusTone, StatusTone, StatusTone, StatusTone];
  /** Usage/context pill tones from empty/cold to near-full/hot. */
  statusContextScale: [
    StatusTone,
    StatusTone,
    StatusTone,
    StatusTone,
    StatusTone,
  ];
  /** Error text. */
  error: Color | undefined;
  /** Overlay modal background. */
  overlayBg: Color | undefined;
}
```

The default theme uses the full ANSI 16-color terminal palette where semantic accents or pill styling benefit from it, including bright variants (`color08`-`color15`) rather than restricting itself to the base 8 colors. Semantic colors should still map sensibly (for example, greens for additions/success and reds for removals/errors), but the status bar now uses independent stepped tone scales rather than one shared outer-pill background. The inner CWD/git pills stay neutral, while the model pill and usage pill each move from cold/dark to warm/bright on their own scale. The default outer-pill palette families are green → cyan → purple → red, with the hottest context band using a brighter red than the regular red band. Each status tone includes both foreground and background colors so contrast remains acceptable on both light and dark terminals. Status pill backgrounds are applied only behind the text and padding, never across the full width of the status area. Theme values are cel-tui colors; `undefined` means "use the terminal default".

### Status bar

One line, two-sided, rendered as compact padded pills rather than a full-width footer band:

```
[ anthropic/sonnet-4 · med ] [ ~/src/mini-coder ]            [ main +3 ~1 ▲ 2 ] [ in:1.2k out:0.8k · 42.0%/200k · $0.03 ]
```

- Background is applied only behind each pill's text + padding; there is no bottom divider below the input and no full-width colored block.
- The inner pills (`cwd` on the left, `git` on the right) use the neutral `statusSecondary` tone.
- The outer-left `model/effort` pill chooses its tone from `statusEffortScale`, mapped to reasoning effort from low/cold to xhigh/warm.
- The outer-right `usage/context/cost` pill chooses its tone from `statusContextScale`, mapped to estimated context pressure from empty/cold to near-full/hot.
- The two outer pills are independent; high effort does not force a hot context pill, and high context usage does not force a hot effort pill.
- The git pill is omitted outside a repo, preserving the current omission behavior.

**Left side:**

- Outer-left: `provider/model · effort`. Effort shown as `low`, `med`, `high`, `xhigh`.
- Effort tone mapping: `low` → scale 0, `medium` → scale 1, `high` → scale 2, `xhigh` → scale 3.
- Inner-left: CWD, abbreviated with `~` for home. Truncated from the left (`…/mini-coder`) on narrow terminals.

**Right side:**

- Inner-right: git branch, working tree counts (+ staged, ~ modified, ? untracked), and remote divergence counts when present (▲ N ahead, ▼ N behind). Omitted outside a repo.
- Outer-right: `in:input out:output · context%/window · $cost`. `in`, `out`, and `$cost` are **cumulative for the session**. `context%/window` shows the **estimated current context usage for the next model request** as a percentage of the active model's context window.
- Context tone mapping: `<25%` → scale 0, `25-49.9%` → scale 1, `50-74.9%` → scale 2, `75-89.9%` → scale 3, `>=90%` → scale 4.

Token counts use human-friendly units (1.2k, 45k, 1.2M). Context usage is estimated from the current model-visible conversation, not just the last assistant message. Use the most recent valid assistant `usage` as an anchor (`totalTokens` when present, otherwise `input + output + cacheRead + cacheWrite`) and add heuristic estimates for any later messages. If no assistant `usage` exists yet, estimate the full current model-visible history heuristically. UI-only messages are excluded from this estimate.

#### Status bar sketches

```text
[ anthropic/sonnet-4 · med ] [ ~/src/mini-coder ]            [ main +3 ~1 ▲ 2 ] [ in:1.2k out:0.8k · 42.0%/200k · $0.03 ]
[ openai/gpt-5-mini · low ] [ ~/src/mini-coder ]                                          [ in:220 out:90 · 8.0%/200k · $0.00 ]
[ openrouter/qwen3-coder · xhigh ] [ …/mini-coder ]        [ feat/ui ~4 ?2 ▲ 7 ▼ 1 ] [ in:180k out:24k · 93.0%/200k · $2.10 ]
```

The outer-left pill tone changes with effort, the outer-right pill tone changes with context pressure, and the inner pills stay neutral.

### Conversation log

Scrollable area that shows the full conversation history. Stick-to-bottom by default (new content auto-scrolls), user can scroll up to review, scrolling back to bottom re-enables auto-scroll. Conversation updates are streamed into this log as they happen; the UI should not wait for a completed turn before showing progress.

Message types and their rendering:

Tool blocks share a common frame: a left border (`│`) plus a compact header pill naming the tool and direction (`tool ->` for assistant tool calls, `tool <-` for tool results). Tools may append compact metadata such as a file path after the pill on the same line. The body renders tool-specific content rather than raw JSON.

- **User messages**: displayed as plain text with a subtle background color to distinguish them from agent responses. No prefix or role indicator.
- **Assistant messages**: streamed raw markdown rendered via cel-tui's `SyntaxHighlight` component on the default background so the log stays copy-friendly and preserves markdown markers. Thinking/reasoning content is collapsible (shown or hidden according to the user's persisted `/reasoning` preference; defaults to shown when no setting exists).
- **Tool calls — shell**: rendered in the shared tool frame. The assistant tool call streams the command as it arrives. The command preview and shell tool result body use [verbose tool rendering](#verbose-tool-rendering). Shell tool results render the tool output content below a `shell <-` header.
- **Tool calls — read**: rendered in the shared tool frame. The in-progress tool-call preview streams `path`, `offset`, and `limit` in a structured styled layout rather than raw JSON. The preview body uses [verbose tool rendering](#verbose-tool-rendering). Successful results render syntax-highlighted file content as it streams in; the `read <-` header line appends the resolved file path on the same line, and the result body also uses [verbose tool rendering](#verbose-tool-rendering). Errors render the returned error text.
- **Tool calls — grep**: rendered in the shared tool frame. The in-progress tool-call preview streams its arguments in a structured styled layout rather than raw JSON, including the pattern, optional path/glob, and any active flags or limits. The preview body uses [verbose tool rendering](#verbose-tool-rendering). Successful results render a structured, styled list parsed from `rg --json`, focused on session-CWD-relative filenames and matches (with context lines when present), and the result body also uses [verbose tool rendering](#verbose-tool-rendering). Errors render the returned error text.
- **Tool calls — edit**: rendered in the shared tool frame. The in-progress tool-call preview shows the target path followed by the streamed `oldText` and `newText` bodies. Old text is styled as removed and new text as added, but the preview does not render literal `-`/`+` diff prefixes. The preview body uses [verbose tool rendering](#verbose-tool-rendering). Successful results render a compact confirmation block (`edit <-` plus the file path); errors render the returned error text.
- **Tool calls — todoWrite / todoRead**: rendered in the shared tool frame. Successful results render the full current todo list as a structured themed checklist with status markers (`[ ]`, `[~]`, `[x]`). This checklist is always shown in full and never truncated, regardless of `/verbose`. Errors render the returned error text.
- **Tool calls — readImage**: rendered in the shared tool frame. The assistant tool call streams the path as it arrives. Successful results render a compact result block (`read image <-` plus the file path) rather than rendering the image itself.
- **Tool calls — plugin tools**: rendered in the shared tool frame, prefixed with plugin/tool name when available.
- **UI messages**: internal app messages such as `/help` output, OAuth progress, `/fork` notices, and other session-local notices. They are rendered in the conversation log, persisted with the session, excluded from model context, and do not participate in conversational turn numbering. `/help` output renders as syntax-highlighted raw markdown so headings, lists, and inline code stay scannable while preserving the literal markdown markers. `/todo` output is also UI-only, but it renders using the same structured todo-checklist block as todo tool results instead of plain info text.
- **Errors**: one-line summary, styled distinctly.

#### Verbose tool rendering

`/verbose` controls a single persisted UI preference for how tool-call previews and selected tool-result bodies are displayed in the conversation log.

- Scope: shell tool-call bodies and tool-result bodies; read tool-call bodies and tool-result bodies; grep tool-call bodies and tool-result bodies; edit tool-call preview bodies and edit error results. Successful edit results stay compact in both modes. Todo tool results ignore `/verbose` and always show the full current list.
- Default: off when no saved setting exists.
- Off: show as many trailing logical lines as fit within a fixed rendered-height preview, followed by `And X lines more` when earlier lines are hidden. The preview height stays stable for a given block, so wrapped long lines do not make the log jump while content streams.
- On: show the full stored tool result or preview body.
- Persistence: the new on/off state is saved immediately and restored on launch.
- This is a UI-only display choice over streamed tool-call previews and stored tool results; it does not affect tool execution or any tool's own truncation / continuation behavior.

#### Conversation log sketches

Representative entry shapes:

**User**

```text
  ┌─────────────────────────────────────────────┐
  │ fix the failing session tests               │
  └─────────────────────────────────────────────┘
```

**Assistant (`/reasoning` on)**

```text
  I should run the focused session tests first and inspect turn assignment.
  Then report any issues to the user.
  That is good reasoning for my next steps.

  I'll run the session tests first.
```

**Assistant (`/reasoning` off)**

```text
  Thinking... 3 lines.

  I'll run the session tests first.
```

**Shell tool call**

```text
  │ shell -> bun test src/session.test.ts
```

**Shell tool result (`/verbose` off)**

```text
  │ shell <-
  │ src/session.test.ts:
  │   ✓ loads persisted turns
  │   ✓ undoes the latest turn
  │   ✗ keeps ui messages out of model context
  │
  │   1 failed, 2 passed
  │   exit 1
  │ And 14 lines more
```

**Shell tool result (`/verbose` on)**

```text
  │ shell <-
  │ src/session.test.ts:
  │   ✓ loads persisted turns
  │   ✓ undoes the latest turn
  │   ✗ keeps ui messages out of model context
  │
  │   AssertionError: expected 2 to be 1
  │   at <anonymous> (src/session.test.ts:84:23)
  │   exit 1
```

**Read tool call preview**

```text
  │ read ->
  │ src/ui/conversation.ts
  │ offset: 820
  │ limit: 80
```

**Read tool result (`/verbose` off)**

```text
  │ read <- src/ui/conversation.ts
  │ function renderToolBlock(
  │   spec: ToolBlockSpec,
  │   opts: Pick<ConversationRenderOpts, "previewWidth" | "theme" | "verbose">,
  │ ) {
  │   const body = renderToolBody(spec, opts);
  │   ...
  │ And 48 lines more
```

**Grep tool call preview**

```text
  │ grep ->
  │ renderToolBlock
  │ path: src
  │ glob: *.ts
  │ context: 2
```

**Grep tool result (`/verbose` off)**

```text
  │ grep <-
  │ src/ui/conversation.ts
  │   857: function renderToolBlock(
  │   858:   spec: ToolBlockSpec,
  │
  │ src/ui/conversation.ts
  │   1098: return renderToolBlock(buildShellToolResultSpec(content), opts);
  │ And 6 lines more
```

**Edit tool call preview (`/verbose` off)**

```text
  │ edit ->
  │ src/session.ts
  │   const turn = getCurrentTurn(sessionId);
  │   const turn = getNextTurn(sessionId);
  │ And 9 lines more
```

**Edit tool call preview (`/verbose` on)**

```text
  │ edit ->
  │ src/session.ts
  │   const turn = getCurrentTurn(sessionId);
  │   const turn = getNextTurn(sessionId);
  │   saveMessage(sessionId, turn, message);
  │   return turn;
```

**Edit tool result**

```text
  │ edit <-
  │ ~ src/session.ts
```

**ReadImage tool**

```text
  │ read image <-
  │ screenshots/failing-layout.png
```

**Plugin tool**

```text
  │ mcp/search <-
  │ session persistence sqlite turn numbering
```

**UI message**

```text
  Loaded 3 skills from ~/.agents/skills
```

**Error**

```text
  Error: command exited with code 2
```

While the agent is working, the top divider (above the input area) animates with a scanning pulse — a bright and colored (be creative) segment sweeping across the dimmed divider line. The animation starts when a turn begins and stops when the turn ends (done, error, or aborted). No per-activity state tracking.

mini-coder also updates the terminal title. While idle, the title is `mc` when there is no conversational text yet; otherwise it is `mc - <tail preview>`, where `<tail preview>` is the last five words of the most recent non-UI user or assistant text message, with whitespace collapsed to a single line and `...` prefixed when the preview was truncated. While a turn is active, the title switches to a stable-width glow-scanner animation (for example `mc - [=o---]`, `mc - [-=o--]`, `mc - [--=o-]`) so the title bar does not shift horizontally between frames, and it switches back to the idle title when the turn ends. After suspend/resume, mini-coder re-applies the current title on the first resumed render so shell-owned titles do not stick.

#### Divider sketches

```text
idle:   ────────────────────────────────────────────────────────────
frame1: ────══════──────────────────────────────────────────────────
frame2: ─────────────══════─────────────────────────────────────────
frame3: ────────────────────────══════──────────────────────────────
```

### Input area

Multi-line text input with no prompt prefix — the blinking cursor is the affordance. Intrinsic height starts at 2 lines when empty (`minHeight: 2`), grows with content up to `maxHeight: 10`, then scrolls internally. Enter submits, Shift+Enter adds newlines (via cel-tui's `TextInput` `onKeyPress` pattern). If the agent is already working, a submitted model-visible message becomes a queued steering message rather than interrupting or disappearing; use `Escape` to interrupt immediately.

Supports:

- `Tab` for file path autocomplete.
- `Ctrl+R` for global input history search. Opens the same centered Select overlay pattern used by interactive commands, populated with previously submitted raw prompt text from all sessions and working directories, newest first. The list is searchable, selecting an entry restores the exact raw prompt into the input for editing (it does not auto-submit), and dismissing the overlay leaves the current draft unchanged and returns focus to the input.
- `/command` prefix for slash commands.
- `/skill:skill-name` prefix to inject a skill's body into the user message. The `/skill:name` prefix is stripped from the input and the skill's `SKILL.md` body is prepended to the user message content. The rest of the input becomes the user's instruction. Example: `/skill:code-review check the auth module` sends the code-review skill body + "check the auth module" as the user message.
- Image embedding: if we autocomplete a file path ending in `.png`, `.jpg`, `.jpeg`, `.gif`, or `.webp`, and the file exists, it is embedded as `ImageContent` in the user message (base64-encoded). Only when the current model supports image input (`Model.input` includes `"image"`). If the model doesn't support images, or the file doesn't exist, or the input contains other text, the path is sent as plain text. This is intentionally simple — no inline detection within sentences.

#### Input area sketches

Empty input still reserves 2 lines of height; examples below only show visible text.

```text
fix the remaining lint warnings_

fix the remaining lint warnings
in the utils file too_

summarize the issue
compare the current flow
explain the regression
...
add tests for undo_
```

### Key bindings

| Key           | Context                   | Action                                                                           |
| ------------- | ------------------------- | -------------------------------------------------------------------------------- |
| `Enter`       | Input focused             | Submit message                                                                   |
| `Shift+Enter` | Input focused             | Insert newline                                                                   |
| `Escape`      | Overlay open              | Dismiss overlay, leave the draft unchanged, and return focus to the input        |
| `Escape`      | Agent working, no overlay | Interrupt current turn, preserve partial response, and return focus to the input |
| `Escape`      | Idle, no overlay          | No action                                                                        |
| `Tab`         | Input focused             | File path autocomplete                                                           |
| `Ctrl+R`      | Input focused             | Search global raw input history                                                  |
| `Ctrl+C`      | Any                       | Graceful exit                                                                    |
| `Ctrl+D`      | Input empty               | Graceful exit (EOF)                                                              |
| `:q`          | Input focused             | Graceful exit                                                                    |
| `Ctrl+Z`      | Any                       | Suspend/background process                                                       |
| Mouse wheel   | Log area                  | Scroll conversation history                                                      |

### Commands

| Command      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/model`     | Interactive model selector. The list includes built-in models plus any custom OpenAI-compatible models discovered from `settings.json`. Switching models mid-session is allowed — pi-ai's context is model-agnostic. The `readImage` tool is re-evaluated (added/removed based on the new model's capabilities). The status bar updates immediately, and the selected model is persisted immediately as the user's global default. The session record's `model` field is not updated (it reflects the initial choice). |
| `/session`   | Interactive session manager (list, resume). Sessions scoped to CWD.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/new`       | Start a new session. Clears conversation, resets cost/token counters.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/fork`      | Fork the current conversation into a new session. Copies the full message history, continues from here independently, and appends a UI-only `Forked session.` notice in the new session. The original session is preserved.                                                                                                                                                                                                                                                                                            |
| `/undo`      | Remove the last conversational turn from history: the most recent user message and all assistant/tool messages that followed in that turn. Persisted UI messages are not part of turns and are not removed by `/undo`. Context-only — does not revert filesystem changes.                                                                                                                                                                                                                                              |
| `/reasoning` | Toggle display of model thinking/reasoning content in the log. The new on/off state is persisted immediately and restored on launch. When no setting exists yet, reasoning defaults to shown.                                                                                                                                                                                                                                                                                                                          |
| `/verbose`   | Toggle [verbose tool rendering](#verbose-tool-rendering) for shell previews/results, read previews/results, grep previews/results, edit previews, and edit errors. Successful edit results stay compact regardless of this setting. Todo tool results always render in full.                                                                                                                                                                                                                                           |
| `/todo`      | Append the current session todo list to the conversation pane as a UI-only checklist block. The message is persisted with the session, excluded from model context, and does not create a session by itself when no session exists yet.                                                                                                                                                                                                                                                                                |
| `/login`     | Interactive OAuth login. Shows a selector with available OAuth providers and their login status (logged in / not logged in). Selecting a provider starts the browser-based OAuth flow. Uses pi-ai's OAuth registry. Credentials are persisted to the app data directory and used for provider discovery on subsequent launches.                                                                                                                                                                                        |
| `/logout`    | Interactive OAuth logout. Shows a selector with logged-in OAuth providers. Selecting one clears its saved credentials.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/effort`    | Interactive effort selector. Shows the four reasoning levels (`low`, `medium`, `high`, `xhigh`) with the current level highlighted. Updates the status bar immediately, and the selected effort is persisted immediately as the user's global default. The session record's `effort` field is not updated (it reflects the initial choice, like `/model`).                                                                                                                                                             |
| `/help`      | List available commands, including the current on/off state of `/reasoning` and `/verbose`, plus loaded AGENTS.md files, discovered skills, and active plugins.                                                                                                                                                                                                                                                                                                                                                        |

Commands are discoverable when the input starts with `/`: pressing `Tab` in that state switches from file-path autocomplete to interactive command select/filter.

### Headless one-shot mode

mini-coder also supports a non-interactive one-shot mode for scripting and benchmark harnesses.

`-p, --prompt <text>` submits exactly one user prompt, runs the full agent loop for that turn, and exits after the loop ends. No TUI is started. `--json` switches headless stdout from default text mode (final answer on stdout plus lightweight activity snippets on stderr) to the raw NDJSON event stream.

Headless mode is selected when either:

- `-p` / `--prompt` is provided, or
- `stdin` is not a TTY, or
- `stdout` is not a TTY.

Prompt source in headless mode:

- If `-p` / `--prompt` is provided, that value is the raw submitted prompt.
- Otherwise, mini-coder reads the raw submitted prompt from `stdin` until EOF.
- If headless mode was selected because `stdout` is not a TTY but `stdin` is still interactive, startup fails with a clear error unless `-p` was provided. Headless mode does not fall back to an interactive prompt.
- Empty or whitespace-only headless input is an error.

Input parsing in headless mode reuses the same rules as the interactive input area for plain text, `/skill:name`, and standalone image-file paths. Interactive slash commands such as `/model`, `/session`, `/new`, `/fork`, `/undo`, `/login`, `/logout`, `/effort`, `/todo`, and `/help` are not available in headless mode and should fail clearly rather than attempting to open interactive UI.

### Headless text output

In headless mode without `--json`, stdout contains only the final persisted assistant message's text content for the one-shot run. This preserves scriptability for stdout consumers.

Lightweight activity updates may be written to stderr before that final answer, but only as compact assistant-text snippets from tool-use turns. No tool-call details, tool progress, reasoning/thinking text, markdown rendering, status text, or other TUI presentation output is written in this mode.

### Headless JSON output

With `--json`, stdout is a newline-delimited JSON stream (NDJSON). Each line is one JSON object with a `type` field.

This stream is intentionally close to the persisted agent event protocol rather than a flattened summary format, but it only includes completed events. Streaming text/thinking deltas, tool-call assembly events, and tool progress updates are omitted so scripts do not receive duplicate partial content.

At minimum, the streamed event types are:

- `assistant_message`
- `tool_result`
- `done`
- `error`
- `aborted`

Queued/persisted `user_message` events may also appear when the loop injects an additional user message before the next model boundary.

Event payload fields use the same JSON-serializable shapes as the in-process agent stream and persisted pi-ai message content where applicable. No terminal-only formatting, status bar text, markdown rendering, or other TUI presentation output is written to stdout in this mode.

A successful one-shot run continues through any assistant/tool loops and ends only when the agent loop emits `done` (with `stopReason: "stop"` or `"length"`). Errors and user interrupts terminate the stream with `error` or `aborted` respectively.

### Headless persistence semantics

Headless runs persist exactly like interactive runs. A normal session is created lazily when the prompt is submitted, messages are stored with the usual conversational turn numbering, and the raw submitted prompt is recorded in `prompt_history` before any `/skill:name` expansion or image conversion.

This means headless one-shot runs appear in normal `/session` history for that working directory and are included in the same session/message retention rules as interactive use.

### Startup

On launch, mini-coder:

1. Discovers built-in providers (env vars, OAuth tokens).
2. Loads user settings from `~/.config/mini-coder/settings.json`.
3. Discovers user-configured custom OpenAI-compatible providers from `settings.json`.
   - Each entry is queried at `${baseUrl}/models`.
   - Each returned model is added to the launch's available model list as `provider/model`, where `provider` is the configured custom provider name.
   - Invalid entries are dropped while loading settings. Duplicate custom provider names keep the first entry.
   - If an endpoint is unreachable, returns a non-2xx response, or the custom provider name conflicts with an already-available built-in provider, startup continues and a warning is added to the UI log.
4. Selects the startup model, effort, reasoning visibility, and verbose mode from those settings when available.
   - `defaultModel`: if the saved provider/model is currently available, use it; otherwise fall back to the first available model for this launch.
   - `defaultEffort`: if valid, use it; otherwise fall back to `medium`.
   - `showReasoning`: if present, use it; otherwise fall back to `true`.
   - `verbose`: if present, use it; otherwise fall back to `false`.
5. Loads AGENTS.md files, skills, plugins.
6. Selects the launch mode:
   - Interactive TUI when `stdin` and `stdout` are both TTYs and `-p` was not provided.
   - Headless one-shot mode otherwise.
7. In interactive mode, renders the UI with an empty conversation log, a minimal `mini-coder` empty-state banner (showing the packaged version when available, otherwise a simple dev label), and the status bar populated.
8. Starts a new session only when a prompt is actually submitted (no 0-message sessions in the DB).

The empty-state banner is only shown while the conversation log has no messages. In headless mode, stdout is reserved for the final assistant text response by default, with any lightweight non-JSON activity snippets going to stderr, or NDJSON event output when `--json` is used.

## User settings persistence

mini-coder persists global user defaults in `~/.config/mini-coder/settings.json`.

### Stored settings

```json
{
  "defaultModel": "anthropic/claude-sonnet-4",
  "defaultEffort": "medium",
  "showReasoning": true,
  "verbose": false,
  "customProviders": [
    {
      "name": "lm-studio",
      "baseUrl": "http://127.0.0.1:1234/v1"
    }
  ]
}
```

### Semantics

- Settings are **global to the user**, not scoped per project, repository, or session.
- `/model`, `/effort`, `/reasoning`, and `/verbose` persist their new values immediately when changed.
- If `defaultModel` is saved but unavailable at startup (for example, missing credentials), mini-coder keeps the saved preference unchanged and uses a runtime fallback model for that launch.
- Invalid or missing settings file content is treated as "no saved settings" rather than a fatal startup error.
- `/new`, `/fork`, and `/session` do not modify global settings.
- Session records remain historical: their `model` and `effort` fields reflect the values active when that session was created, not the current global defaults.
- `customProviders` is an optional array of user-configured OpenAI-compatible endpoints, typically local model servers.
- Each `customProviders` entry has a `name`, `baseUrl`, and optional `apiKey`. The `name` becomes the provider prefix shown in model ids such as `lm-studio/qwen3-coder`.
- Unreachable or invalid custom providers do not block startup; mini-coder skips them and shows a warning in the interactive log.
- Custom providers are discovered only at startup. There is currently no interactive slash command to add or remove them.

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

CREATE TABLE prompt_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  text        TEXT NOT NULL,      -- exact raw submitted prompt text
  cwd         TEXT NOT NULL,      -- working directory where it was submitted
  session_id  TEXT,               -- optional originating session id for display/context only
  created_at  INTEGER NOT NULL    -- unix ms
);

CREATE INDEX idx_prompt_history_created_at ON prompt_history(created_at, id);
```

### Design decisions

**Messages as JSON blobs**: pi-ai's `Message` type (UserMessage, AssistantMessage, ToolResultMessage) is already serializable, and we also persist internal UI-only log entries in the same table. We store the full object as JSON in `data` rather than normalizing into columns. Session load returns the complete chronological log; model context construction filters out UI-only messages before replaying the remaining pi-ai messages into a pi-ai `Context`.

**Todo state lives in message history**: there is no separate todo table. The current todo list is reconstructed from the latest successful persisted todo snapshot found in session messages. Because that snapshot rides along with normal message history, `/undo`, `/fork`, session reload, and session switching all restore the expected todo state automatically.

**Turn grouping**: the `turn` column groups only conversational messages. A turn is: one user message + the assistant messages and tool result messages produced after that user message until the next user message is consumed. Persisted UI messages are stored alongside them but have `turn = NULL`, so they remain visible in session history without becoming part of `/undo`. Queued steering messages submitted mid-run still start their own turn when they are consumed; tool results already requested by the previous assistant message stay in the previous turn even if the steering message was queued while those tools were running. `/fork` copies all existing persisted messages to a new session, preserving conversational turn numbers and existing UI messages as-is, then appends a new UI-only notice such as `Forked session.` in the fork.

**Cumulative stats are computed, not stored**: the status bar's cumulative `in`, `out`, and `$cost` values are computed by summing `usage` from assistant messages on session load (deserialize all messages, filter for `role: "assistant"`, sum their `usage` fields). The message count per session is small (hundreds), so this is fast. No separate counters to keep in sync. During an active session, a running in-memory accumulator is updated after each assistant message to avoid re-scanning. `context%/window` is separate: it is estimated from the current model-visible history for the next request rather than stored cumulatively.

**Turn number assignment**: when a user message is appended, whether from an idle submission or a queued steering message that is being consumed, its turn number is `MAX(turn) + 1` for the session (or 1 for the first conversational message). Assistant responses and tool results keep the current active turn number until another queued user message is consumed and becomes the next model input. UI-only messages do not receive a turn number. This is what makes `/undo` atomic for conversation history without removing system notices that are still true after the undo.

**Model/effort on the session**: stored at creation for display in `/session` list. The user can change models and effort mid-session via `/model` and `/effort`; those commands update the current in-memory state and global user settings, but the session record still reflects the initial values for that session. Individual assistant messages record their actual model via pi-ai's `AssistantMessage.model`.

**Session truncation**: sessions are truncated per cwd to keep only the 20 most recently updated sessions (`updated_at DESC`), deleting older sessions and their messages via cascade.

**Raw input history is global and append-only**: submitted prompt text is also recorded separately in `prompt_history` as the exact raw input the user entered (interactive mode) or supplied (headless mode) before any `/skill:name` expansion or image conversion. This history is global across sessions and working directories, ordered newest first for `Ctrl+R` search, and is independent from conversational turn state — `/undo` does not remove entries from it. To bound storage, only the 1000 most recent prompt-history rows are kept.

### Operations

| Operation      | SQL                                                                                                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New session    | `INSERT INTO sessions`                                                                                                                                                                                         |
| Append message | `INSERT INTO messages` with the current conversational turn number (or `NULL` for UI-only messages), `UPDATE sessions SET updated_at`                                                                          |
| Undo           | `DELETE FROM messages WHERE session_id = ? AND turn = (SELECT MAX(turn) FROM messages WHERE session_id = ?)`                                                                                                   |
| Fork           | `INSERT INTO sessions` (new id, `forked_from` set), then `INSERT INTO messages SELECT ... FROM messages WHERE session_id = ?` (copy all, new session_id), then append a UI-only fork notice with `turn = NULL` |
| List sessions  | `SELECT * FROM sessions WHERE cwd = ? ORDER BY updated_at DESC`                                                                                                                                                |
| Load session   | `SELECT data FROM messages WHERE session_id = ? ORDER BY id` → parse JSON → persisted message log (`pi-ai Message[]` + internal UI messages)                                                                   |
| Delete session | `DELETE FROM sessions WHERE id = ?` (cascade deletes messages)                                                                                                                                                 |
