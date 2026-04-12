<p align="center">
  <img src="assets/icon-2-dark-terminal.svg" alt="mini-coder logo" width="112" />
</p>

<h1 align="center">mini-coder</h1>

<p align="center"><strong>Lightning-fast coding agent for your terminal.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/mini-coder">npm</a>
  ·
  <a href="https://sacenox.github.io/mini-coder/">docs</a>
  ·
  <a href="spec.md">spec</a>
</p>

<p align="center">
  <picture>
    <img src="assets/preview.gif" alt="mini-coder terminal session preview" width="960" style="border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.35);" />
  </picture>
</p>

mini-coder (`mc`) is a terminal coding agent that reads your repo, edits files, runs commands, and keeps going until the work is done. Small core tool surface, flat architecture, fast turns, and streaming everywhere it matters.

## Install

```bash
$ bun add -g mini-coder
$ mc
```

## Why mini-coder?

- **Lean on proven dependencies** — [pi-ai](https://github.com/badlogic/pi-mono/tree/main/packages/ai) for providers, streaming, tool calling, usage tracking, and OAuth. [cel-tui](https://github.com/sacenox/cel-tui) for the terminal UI. The core stays focused on agent work.
- **Flat, simple codebase** — no workspaces, no internal abstraction layers. Files grouped by concern in a single `src/` directory.
- **Agent-first** — every decision serves the goal of reading code, making changes, and verifying them via the shell.
- **Performance** — startup and turn latency matter more than features.
- **Streaming end-to-end** — assistant text, reasoning, tool calls, and tool output show up as they happen.

## Tools

Two built-in tools, plus a read-only image tool:

- **`shell`** — runs commands in the user's shell. Returns stdout, stderr, and exit code. Large output is truncated to protect model context.
- **`edit`** — exact-text replacement in a single file. Fails deterministically if the target is missing or ambiguous. Creates new files when old text is empty.
- **`readImage`** — reads PNG, JPEG, GIF, and WebP files as model input. Only registered when the active model supports images.

Plugins can add more tools, but the core stays intentionally small.

## Features

- **Multi-provider model support** — Anthropic, OpenAI, Google, Bedrock, Mistral, Groq, xAI, OpenRouter, Ollama, Copilot, and more via pi-ai.
- **Streaming TUI** — markdown conversation log, tool blocks with diffs, animated divider, multi-line input, and a one-line pill status bar with independent ANSI16 effort/context tones.
- **Session persistence** — SQLite-backed sessions with undo, fork, resume, and cumulative usage stats. Sessions are scoped to the working directory.
- **Reasoning and verbosity controls** — toggle thinking visibility and verbose tool rendering on demand. Preferences persist across launches.
- **[AGENTS.md](https://agents.md) support** — project-specific instructions discovered root-to-leaf, with `~/.agents/` for global instructions.
- **[Agent Skills](https://agentskills.io)** — skill catalogs exposed in the prompt. `/skill:name` injects a skill body into the next user message.
- **Plugins** — optional tools, integrations, theme overrides, and prompt suffixes without bloating the core.

## Commands

| Command      | Description                                                            |
| ------------ | ---------------------------------------------------------------------- |
| `/model`     | Switch models. Persists as the global default.                         |
| `/session`   | List and resume sessions scoped to the current working directory.      |
| `/new`       | Start a fresh session and reset cumulative usage counters.             |
| `/fork`      | Copy the conversation into a new session and continue independently.   |
| `/undo`      | Remove the last conversational turn (does not revert file changes).    |
| `/reasoning` | Toggle thinking visibility. Persisted and restored on launch.          |
| `/verbose`   | Toggle verbose shell rendering plus edit previews/errors in the log.   |
| `/login`     | Interactive OAuth login for supported providers.                       |
| `/logout`    | Clear saved OAuth credentials for a logged-in provider.                |
| `/effort`    | Set reasoning effort: low, medium, high, or xhigh.                     |
| `/help`      | List commands, loaded AGENTS.md files, discovered skills, and plugins. |

## Key bindings

| Key           | Action                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `Enter`       | Submit message                                                                                    |
| `Shift+Enter` | Insert newline                                                                                    |
| `Escape`      | Close the current overlay and refocus input; otherwise interrupt the active turn; otherwise no-op |
| `Tab`         | File path autocomplete (or command filter on `/`)                                                 |
| `Ctrl+R`      | Search global raw input history                                                                   |
| `Ctrl+C`      | Graceful exit                                                                                     |
| `Ctrl+D`      | Graceful exit (EOF, when input is empty)                                                          |
| `:q`          | Graceful exit                                                                                     |

## Headless one-shot mode

mini-coder also supports a non-interactive one-shot mode for scripts and benchmark harnesses.

```bash
$ mc -p "summarize this repo"
$ printf '%s\n' 'fix the failing tests' | mc
```

- Enabled when `-p/--prompt` is provided or when stdin/stdout is not a TTY.
- Reuses the same input parsing rules as the interactive UI for plain text, `/skill:name`, and standalone image paths.
- Streams newline-delimited JSON events to stdout.
- Interactive slash commands such as `/model` and `/help` are not available in headless mode.

## Docs

- **Docs site:** https://sacenox.github.io/mini-coder/
- **Spec:** [`spec.md`](spec.md)
- **Repo instructions:** [`AGENTS.md`](AGENTS.md)

## Development

```bash
bun install
bun test
bun run check
bun run format
bun run typecheck
```

## License

MIT
