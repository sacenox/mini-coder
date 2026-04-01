## Core idea: treat this as the source of truth for the design and implementation.

mini-coder - `mc`

An augmented shell-prompt coding agent: small, fast, and out of the way.

### Inspirations

- Pi agent: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent
- Claude Code: https://claude.com/product/claude-code
- Codex: https://github.com/openai/codex
- Opencode: https://opencode.ai/

### Philosophy

**Performance first, style second.**

Core features must be correct and fast before adding new ones.
Community-oriented: support `AGENTS.md` and `agentskills.io` specs, and do not introduce new config formats.

### Features

- Auto-discover and load community config standards on startup:
  - `AGENTS.md` -> https://agents.md/
  - Skills -> https://agentskills.io/client-implementation/adding-skills-support

- Auto-discovery of providers via env vars (example: `OPENCODE_API_KEY`) or local servers (example: Ollama).
  - `/login` shows OAuth login status. `/login <provider>` starts browser-based OAuth login. `/logout <provider>` clears saved tokens. support OpenAI (`openai` uses the Codex / ChatGPT Plus/Pro flow) and Anthropic (Claude Max/Pro). Use Pi coding agent source code as a reference for this.
  - `/model` picks a model from connected providers. The selection persists across sessions and uses an interactive selector.
  - `/effort [args]` sets the model effort.

- Connect to MCP servers over Streamable HTTP / SSE fallback or stdio.
  - Auto-discover keys like `EXA_AI_API_KEY` to auto-connect to their MCP server.
  - `/mcp` lists, adds, and removes MCP servers. Servers are stored in SQLite.

- Session management and commands to create, resume, and list sessions using a local SQLite file.
  - `/session` interactively manages sessions. Sessions are scoped to the CWD to avoid cross-project session pollution.
  - `/new` starts a new session with an empty message history, clears the screen, and redraws the banner.
  - `/fork` forks the conversation into a new session.
  - `/undo` removes the last turn from history (does not restore filesystem).
  - Sessions should also track errors and logs in a separate table from messages, mostly for debugging purposes, and should not affect the user session.

- Enriched user prompt:
  - Rich line editing, history, and paste support. Enter submits; Shift+Enter adds new lines.
  - Reference skills from the working directory and global configs with `/skill:...` in the prompt input, plus interactive autocomplete for skills to include in the prompt.
  - Press `Esc` at any point during an assistant response to interrupt it. The partial response is preserved in history with an interrupt stub appended (so the LLM retains context), and the user is returned to the prompt. `Ctrl+C` and `Ctrl+D` (EOF) gracefully exit. `Ctrl+Z` suspends/backgrounds the process and returns the user to the shell prompt.
  - Reference files with `@`, which embeds a file path into the prompt and autocompletes interactively. It also supports adding images to the prompt if the referenced file is an image.
  - On error, display a one-line summary to the user, and return to the input prompt.

- Context handling:
  - Stop with a conversation summary at max context. This must not break prompt caching.
  - No max steps or tool call limits — user can interrupt.
  - Clear, accurate token and cost tracking. Use `models.dev` as the source for model metadata and costs.

- Minimal tool surface: `shell`, `edit`, `listSkills`, `readSkill`.
  - Inspect with `shell` -> mutate with `edit` -> verify with `shell`.
  - Auto-truncate large shell outputs for the LLM to avoid context explosions.
  - `edit`: exact-text edits only, deterministic failures on stale/ambiguous state. Based on industry standard edit/apply patch tools.
  - A single system prompt that works across all supported models (no provider-specific branches). It is constructed based on our inspirations and provider resources such as:
    - https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide
    - https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices

- Other commands in the CLI prompt:
  - `/reasoning` toggles display of model reasoning output.
  - `/verbose` toggles output truncation. When off, large outputs keep the start/end sections and truncate the middle. This is a UI-only visibility concern.

- Internal skill (hidden from the user) that teaches the agent how to use minicoder and help the user configure it and use it well. Should be compliant with the agentskills.io specification.

- App data folder in `~/.config/mini-coder/` in linux, or the respective app data folder in other OS. It includes sqlite db file and logs.

### UI/Output

- Use the 16 ANSI colors so coloring is always inherited from the terminal theme (https://jvns.ca/blog/2024/10/01/terminal-colours/). Keep a `theme.json` file in the app data directory with the palette used so users can customize colors, italics, bold, and glyphs.
- Never use ambiguous-width characters; stick with single-width Unicode characters for maximum cross-terminal compatibility.
- Minimal banner at app start showing loaded context files, skills, connected providers, and configured MCP servers.
- Scrolling conversation log (new output pushes the input prompt down):
  - Skill tools: one-line name + description, no body content.
  - Shell tool: the command, then its stdout/stderr.
  - Edit tool: a clean diff of the change applied.
  - MCP tools: prefixed with server name to distinguish from built-in tools.
- Status bar below the input prompt showing model, model effort, provider, session ID, git branch, context usage %, and concise token and cost counts.
- Clear boundary around the user input area. The area expands as new lines are added.
- Inline spinner with an activity label (e.g. "thinking", "running shell") when a turn is in flight for all actions and while waiting for the LLM to complete its work. It must not interfere with scrollback or leave artifacts on interrupt.

### Tech stack

- Bun.js for runtime and package management. https://bun.com/docs
- Multiprovider support via Pi's: https://github.com/badlogic/pi-mono/tree/main/packages/ai (it saves us a lot of headaches by already having oauth baked in.)
- MCP via the official SDK: `@modelcontextprotocol/sdk`
- Colored output with https://github.com/sindresorhus/yoctocolors - limited but fast.
- Our own helper packages: `@yoctomarkdown` for streamed Markdown rendering and `@yoctoselect` for a simple, fully featured interactive selector.
- sqlite for sql storage

### Repo structure

We want to break everything down into workspaces as internal packages. This will force us to have clear boundaries for each package and improve maintainability.

Suggested core packages:

- `terminal-ui`: the UI implementation and all output concerns, isolated from the rest of the project so we can more easily support other output formats going forward.
- `agent`: the agent implementation, which is the core of the project.
- `providers`: the unified provider implementation/sdk usage.
- `storage`: implements the storage interface using SQLite for persistence.
- `types`: shared types.

### Extensibility (NOT IN SCOPE! DO NOT IMPLEMENT)

Users should be able to extend mini-coder easily with a plugin format. This should enable custom commands, providers, context handling, etc. While this is currently out of scope and not fully defined, it should be kept in mind during development so we avoid unnecessary complexity when we do add it.
