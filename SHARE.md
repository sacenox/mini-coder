# 👾 mini-coder — small, fast CLI coding agent

> A terminal-native AI coding agent that stays out of your way.

```bash
bun add -g mini-coder
# or: npm install -g mini-coder
mc
```

- **Multi-provider** — Anthropic, OpenAI, Google, Ollama, auto-detected from env vars
- **Session memory** — local SQLite, resume with `mc -c`
- **Shell integration** — `!command` inline, `@file` references with tab completion
- **Subagents** — spawns parallel agents for independent subtasks
- **Built-in web search** — enable Exa-backed `webSearch`/`webContent` with `EXA_API_KEY`
- **MCP support** — connect external tools and servers
- **Shell-first editing** — inspect with shell, make targeted edits with `mc-edit`, verify with shell
- **16 ANSI colors** — inherits your terminal theme, always

No telemetry. No cloud accounts. No bloat.

🔗 https://github.com/sacenox/mini-coder