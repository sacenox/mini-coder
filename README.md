# mini-coder

A CLI coding agent. Small, fast, focused.

## What is it?

mini-coder (`mc`) is a terminal-based coding agent that reads your codebase, makes changes, and verifies them — all through natural conversation. It runs in your terminal, connects to your preferred LLM provider, and gets work done.

## Features

- **Two core tools**: `shell` and `edit` — inspect, mutate, verify.
- **Multi-provider**: Anthropic, OpenAI, Google, and many more via [pi-ai](https://github.com/badlogic/pi-mono/tree/main/packages/ai).
- **Rich TUI**: Streamed markdown, scrollable conversation log, status bar — powered by [cel-tui](https://github.com/sacenox/cel-tui).
- **Sessions**: Persistent conversation history, fork, undo.
- **Community standards**: [AGENTS.md](https://agents.md) and [Agent Skills](https://agentskills.io) support.
- **Plugins**: Extend with custom tools, MCP servers, and more.

## Install

```bash
# coming soon
bun install -g mini-coder
```

## Usage

```bash
mc
```

## License

MIT
