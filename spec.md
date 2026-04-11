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

## Tools

Two built-in tools, plus a read-only image tool. Plugins may add more (see [Plugins](#plugins)).

### `shell`

Runs a command in the user's shell. Returns stdout, stderr, and exit code. Use it to explore the codebase, read tests/verifiers/examples, inspect required outputs, and run targeted checks, builds, or git commands.

Implementation details:

- Large outputs are truncated as a safety guard against context explosion from bad or overly broad commands (for example, accidentally reading a huge file, binary, or unbounded command output). This guard applies to both very tall output (many lines) and very wide output (a few extremely long lines), and is not related to the user-configured verbose setting.
- The truncation threshold is configurable, tuned to keep useful output while staying well within context limits. This tool-level truncation is intentionally narrow in scope: it protects the model context from pathological output, not as a general-purpose presentation layer for every output-shaping concern.
- Commands run via `$SHELL -c "<command>"` (falling back to `/bin/sh` if `$SHELL` is unset) with the CWD set to the session's working directory.
- Before execution, the harness may apply a small set of silent, lossless compatibility normalizations for common model-authored shell mistakes when the intended command is unambiguous (for example, moving a heredoc trailer's `|`, `&&`, or `>` continuation back onto the heredoc start line, or rewriting `printf '--- ...'` to `printf -- '--- ...'` when the format string begins with `-`).
- Compatibility normalization is best-effort and intentionally narrow. If a rewrite is ambiguous or the normalization step itself fails, the raw command is executed unchanged.
- Timeout: no default timeout. The user can interrupt via `Escape`.

### `edit`

Exact-text replacement in a single file. Use it to write the exact file content the task requires.

Implementation details:

- Takes a file path (absolute, or relative to the session CWD), the old text to find, and the new text to replace it with.
- The replacement text is inserted literally. Replacement markers such as `$$`, `$&`, `$'`, and the JS prefix marker ($ followed by a backtick) are not expanded.
- Fails deterministically if the old text is not found or matches multiple locations. Returns a descriptive error with nearby similar snippets or match locations so the model can self-correct.
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

You are an autonomous, senior-level coding assistant. When the user gives a direction, proactively gather context, plan with the user, implement, and verify. Bias toward action: plan briefly when needed to clear important assumptions, then continue into implementation. First identify the task contract: required files, names, interfaces, output format, and checks for success. Treat those details as part of correctness, not as polish. Deliver working code, unless you are genuinely blocked.

# Tools

You have these core tools:

- `shell` — run commands in the user's shell. Use this to explore the codebase, read tests/verifiers/examples, inspect required outputs, and run targeted checks, builds, or git commands. Prefer `rg` over `grep` for speed.
- `edit` — make exact-text replacements in files. Provide the file path, the exact text to find, and the replacement text. The old text must match exactly one location in the file. To create a new file, use an empty old text and the full file content as new text. Use this to write the exact final file content the task requires.

You may also have additional tools provided by plugins. Use them when they match the task.

Workflow: **inspect with shell → mutate with edit → verify with shell**.

# Code quality

- Conform to the codebase's existing conventions: patterns, naming, formatting, language idioms.
- Write correct, clear, minimal code. Prefer the simplest solution that satisfies the task's checks exactly. Don't over-engineer, don't add abstractions for hypothetical futures.
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
- Early in the task, look for acceptance criteria in tests, verifier scripts, eval scripts, examples, and expected-output files. Do not rely on the task text alone when machine-checkable criteria are available.
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
- Once the contract is clear, create the required artifact early, then iterate and improve it. Do not spend most of the turn exploring.
- If you encounter an error, diagnose and fix it rather than reporting it and stopping.
- Before concluding, run the smallest targeted verification that checks the exact contract: required files exist, names and signatures match, outputs are in the required format, and no forbidden extra artifacts were left behind.
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
- **Brief planning, not plan dumping**: the Codex guide notes that prompting for large upfront plans can cause models to stop prematurely. The prompt now asks the agent to plan with the user just enough to clear assumptions, then continue into implementation.
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

- Inner-right: git branch, working tree counts (+ staged, ~ modified, ? untracked), ahead of remote (▲ N). Omitted outside a repo.
- Outer-right: `in:input out:output · context%/window · $cost`. `in`, `out`, and `$cost` are **cumulative for the session**. `context%/window` shows the **estimated current context usage for the next model request** as a percentage of the active model's context window.
- Context tone mapping: `<25%` → scale 0, `25-49.9%` → scale 1, `50-74.9%` → scale 2, `75-89.9%` → scale 3, `>=90%` → scale 4.

Token counts use human-friendly units (1.2k, 45k, 1.2M). Context usage is estimated from the current model-visible conversation, not just the last assistant message. Use the most recent valid assistant `usage` as an anchor (`totalTokens` when present, otherwise `input + output + cacheRead + cacheWrite`) and add heuristic estimates for any later messages. If no assistant `usage` exists yet, estimate the full current model-visible history heuristically. UI-only messages are excluded from this estimate.

#### Status bar sketches

```text
[ anthropic/sonnet-4 · med ] [ ~/src/mini-coder ]            [ main +3 ~1 ▲ 2 ] [ in:1.2k out:0.8k · 42.0%/200k · $0.03 ]
[ openai/gpt-5-mini · low ] [ ~/src/mini-coder ]                                          [ in:220 out:90 · 8.0%/200k · $0.00 ]
[ openrouter/qwen3-coder · xhigh ] [ …/mini-coder ]           [ feat/ui ~4 ?2 ▲ 7 ] [ in:180k out:24k · 93.0%/200k · $2.10 ]
```

The outer-left pill tone changes with effort, the outer-right pill tone changes with context pressure, and the inner pills stay neutral.

### Conversation log

Scrollable area that shows the full conversation history. Stick-to-bottom by default (new content auto-scrolls), user can scroll up to review, scrolling back to bottom re-enables auto-scroll. Conversation updates are streamed into this log as they happen; the UI should not wait for a completed turn before showing progress.

Message types and their rendering:

Tool blocks share a common frame: a left border (`│`) plus a compact header pill naming the tool and direction (`tool ->` for assistant tool calls, `tool <-` for tool results). The body renders tool-specific content rather than raw JSON.

- **User messages**: displayed as plain text with a subtle background color to distinguish them from agent responses. No prefix or role indicator.
- **Assistant messages**: streamed markdown rendered via cel-tui's `Markdown` component on the default background. Thinking/reasoning content is collapsible (shown or hidden according to the user's persisted `/reasoning` preference; defaults to shown when no setting exists).
- **Tool calls — shell**: rendered in the shared tool frame. The assistant tool call streams the command as it arrives. The command preview and shell tool result body use [verbose tool rendering](#verbose-tool-rendering). Shell tool results render the tool output content below a `shell <-` header.
- **Tool calls — edit**: rendered in the shared tool frame. The in-progress tool-call preview shows the target path plus the streamed replacement content, preserving whitespace. The preview body uses [verbose tool rendering](#verbose-tool-rendering). Successful results render a compact confirmation block (`edit <-` plus the file path); errors render the returned error text.
- **Tool calls — readImage**: rendered in the shared tool frame. The assistant tool call streams the path as it arrives. Successful results render a compact result block (`read image <-` plus the file path) rather than rendering the image itself.
- **Tool calls — plugin tools**: rendered in the shared tool frame, prefixed with plugin/tool name when available.
- **UI messages**: internal app messages such as `/help` output, OAuth progress, and other session-local notices. They are rendered in the conversation log, persisted with the session, excluded from model context, and do not participate in conversational turn numbering.
- **Errors**: one-line summary, styled distinctly.

#### Verbose tool rendering

`/verbose` controls a single persisted UI preference for how tool-call previews and selected tool-result bodies are displayed in the conversation log.

- Scope: shell tool-call bodies, shell tool-result bodies, edit tool-call preview bodies, and edit error results only. Successful edit results stay compact in both modes.
- Default: off when no saved setting exists.
- Off: show as many trailing logical lines as fit within a fixed rendered-height preview, followed by `And X lines more` when earlier lines are hidden. The preview height stays stable for a given block, so wrapped long lines do not make the log jump while content streams.
- On: show the full stored tool result or preview body.
- Persistence: the new on/off state is saved immediately and restored on launch.
- This is a UI-only display choice over streamed tool-call previews and stored tool results; it does not affect tool execution or the shell tool's own safety truncation for pathological output.

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

**Edit tool call preview (`/verbose` off)**

```text
  │ edit ->
  │ src/session.ts
  │   const turn = getCurrentTurn(sessionId);
  │   saveMessage(sessionId, turn, message);
  │ And 9 lines more
```

**Edit tool call preview (`/verbose` on)**

```text
  │ edit ->
  │ src/session.ts
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

#### Divider sketches

```text
idle:   ────────────────────────────────────────────────────────────
frame1: ────══════──────────────────────────────────────────────────
frame2: ─────────────══════─────────────────────────────────────────
frame3: ────────────────────────══════──────────────────────────────
```

### Input area

Multi-line text input with no prompt prefix — the blinking cursor is the affordance. Intrinsic height starts at 2 lines when empty (`minHeight: 2`), grows with content up to `maxHeight: 10`, then scrolls internally. Enter submits, Shift+Enter adds newlines (via cel-tui's `TextInput` `onKeyPress` pattern).

Supports:

- `Tab` for file path autocomplete.
- `Ctrl+R` for global input history search. Opens the same centered Select overlay pattern used by interactive commands, populated with previously submitted raw prompt text from all sessions and working directories, newest first. The list is searchable, selecting an entry restores the exact raw prompt into the input for editing (it does not auto-submit), and dismissing the overlay leaves the current draft unchanged.
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

| Key           | Context       | Action                                            |
| ------------- | ------------- | ------------------------------------------------- |
| `Enter`       | Input focused | Submit message                                    |
| `Shift+Enter` | Input focused | Insert newline                                    |
| `Escape`      | Agent working | Interrupt current turn, preserve partial response |
| `Tab`         | Input focused | File path autocomplete                            |
| `Ctrl+R`      | Input focused | Search global raw input history                   |
| `Ctrl+C`      | Any           | Graceful exit                                     |
| `Ctrl+D`      | Input empty   | Graceful exit (EOF)                               |
| `:q`          | Input focused | Graceful exit                                     |
| `Ctrl+Z`      | Any           | Suspend/background process                        |
| Mouse wheel   | Log area      | Scroll conversation history                       |

### Commands

| Command      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/model`     | Interactive model selector. The list includes built-in models plus any custom OpenAI-compatible models discovered from `settings.json`. Switching models mid-session is allowed — pi-ai's context is model-agnostic. The `readImage` tool is re-evaluated (added/removed based on the new model's capabilities). The status bar updates immediately, and the selected model is persisted immediately as the user's global default. The session record's `model` field is not updated (it reflects the initial choice). |
| `/session`   | Interactive session manager (list, resume). Sessions scoped to CWD.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/new`       | Start a new session. Clears conversation, resets cost/token counters.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/fork`      | Fork the current conversation into a new session. Copies the full message history, continues from here independently. The original session is preserved.                                                                                                                                                                                                                                                                                                                                                               |
| `/undo`      | Remove the last conversational turn from history: the most recent user message and all assistant/tool messages that followed in that turn. Persisted UI messages are not part of turns and are not removed by `/undo`. Context-only — does not revert filesystem changes.                                                                                                                                                                                                                                              |
| `/reasoning` | Toggle display of model thinking/reasoning content in the log. The new on/off state is persisted immediately and restored on launch. When no setting exists yet, reasoning defaults to shown.                                                                                                                                                                                                                                                                                                                          |
| `/verbose`   | Toggle [verbose tool rendering](#verbose-tool-rendering) for shell previews/results, edit previews, and edit errors. Successful edit results stay compact regardless of this setting.                                                                                                                                                                                                                                                                                                                                  |
| `/login`     | Interactive OAuth login. Shows a selector with available OAuth providers and their login status (logged in / not logged in). Selecting a provider starts the browser-based OAuth flow. Uses pi-ai's OAuth registry. Credentials are persisted to the app data directory and used for provider discovery on subsequent launches.                                                                                                                                                                                        |
| `/logout`    | Interactive OAuth logout. Shows a selector with logged-in OAuth providers. Selecting one clears its saved credentials.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `/effort`    | Interactive effort selector. Shows the four reasoning levels (`low`, `medium`, `high`, `xhigh`) with the current level highlighted. Updates the status bar immediately, and the selected effort is persisted immediately as the user's global default. The session record's `effort` field is not updated (it reflects the initial choice, like `/model`).                                                                                                                                                             |
| `/help`      | List available commands, including the current on/off state of `/reasoning` and `/verbose`, plus loaded AGENTS.md files, discovered skills, and active plugins.                                                                                                                                                                                                                                                                                                                                                        |

Commands are discoverable when the input starts with `/`: pressing `Tab` in that state switches from file-path autocomplete to interactive command select/filter.

### Headless one-shot mode

mini-coder also supports a non-interactive one-shot mode for scripting and benchmark harnesses.

`-p, --prompt <text>` submits exactly one user prompt, runs the full agent loop for that turn, and exits after the loop ends. No TUI is started.

Headless mode is selected when either:

- `-p` / `--prompt` is provided, or
- `stdin` is not a TTY, or
- `stdout` is not a TTY.

Prompt source in headless mode:

- If `-p` / `--prompt` is provided, that value is the raw submitted prompt.
- Otherwise, mini-coder reads the raw submitted prompt from `stdin` until EOF.
- If headless mode was selected because `stdout` is not a TTY but `stdin` is still interactive, startup fails with a clear error unless `-p` was provided. Headless mode does not fall back to an interactive prompt.
- Empty or whitespace-only headless input is an error.

Input parsing in headless mode reuses the same rules as the interactive input area for plain text, `/skill:name`, and standalone image-file paths. Interactive slash commands such as `/model`, `/session`, `/new`, `/fork`, `/undo`, `/login`, `/logout`, `/effort`, and `/help` are not available in headless mode and should fail clearly rather than attempting to open interactive UI.

### Headless JSON output

In headless mode, stdout is a newline-delimited JSON stream (NDJSON). Each line is one JSON object with a `type` field.

This stream is intentionally raw and close to the internal agent event protocol rather than a flattened summary format. It carries the streaming event payloads needed to observe the full run, including text deltas, thinking deltas, tool-call progress, tool execution progress, persisted assistant/tool-result messages, and terminal events.

At minimum, the streamed event types are:

- `text_delta`
- `thinking_delta`
- `toolcall_start`
- `toolcall_delta`
- `toolcall_end`
- `assistant_message`
- `tool_start`
- `tool_delta`
- `tool_end`
- `tool_result`
- `done`
- `error`
- `aborted`

Event payload fields use the same JSON-serializable shapes as the in-process agent stream and persisted pi-ai message content where applicable. No terminal-only formatting, status bar text, markdown rendering, or other TUI presentation output is written to stdout in headless mode.

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

The empty-state banner is only shown while the conversation log has no messages. In headless mode, stdout is reserved for NDJSON event output.

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

**Turn grouping**: the `turn` column groups only conversational messages. A turn is: one user message + one or more assistant messages + any tool result messages from that agent loop. Persisted UI messages are stored alongside them but have `turn = NULL`, so they remain visible in session history without becoming part of `/undo`. `/fork` copies all persisted messages to a new session, preserving conversational turn numbers and UI messages as-is.

**Cumulative stats are computed, not stored**: the status bar's cumulative `in`, `out`, and `$cost` values are computed by summing `usage` from assistant messages on session load (deserialize all messages, filter for `role: "assistant"`, sum their `usage` fields). The message count per session is small (hundreds), so this is fast. No separate counters to keep in sync. During an active session, a running in-memory accumulator is updated after each assistant message to avoid re-scanning. `context%/window` is separate: it is estimated from the current model-visible history for the next request rather than stored cumulatively.

**Turn number assignment**: when a user message is appended, its turn number is `MAX(turn) + 1` for the session (or 1 for the first conversational message). All subsequent assistant responses and tool results in the same agent loop share that turn number. UI-only messages do not receive a turn number. This is what makes `/undo` atomic for conversation history without removing system notices that are still true after the undo.

**Model/effort on the session**: stored at creation for display in `/session` list. The user can change models and effort mid-session via `/model` and `/effort`; those commands update the current in-memory state and global user settings, but the session record still reflects the initial values for that session. Individual assistant messages record their actual model via pi-ai's `AssistantMessage.model`.

**Session truncation**: sessions are truncated per cwd to keep only the 20 most recently updated sessions (`updated_at DESC`), deleting older sessions and their messages via cascade.

**Raw input history is global and append-only**: submitted prompt text is also recorded separately in `prompt_history` as the exact raw input the user entered (interactive mode) or supplied (headless mode) before any `/skill:name` expansion or image conversion. This history is global across sessions and working directories, ordered newest first for `Ctrl+R` search, and is independent from conversational turn state — `/undo` does not remove entries from it. To bound storage, only the 1000 most recent prompt-history rows are kept.

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
