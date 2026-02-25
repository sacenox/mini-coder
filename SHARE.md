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
- **MCP support** — connect tools like Exa web search
- **Hooks** — auto-run scripts after any tool call via `.agents/hooks/`
- **16 ANSI colors** — inherits your terminal theme, always

No telemetry. No cloud accounts. No bloat.

🔗 https://github.com/sacenox/mini-coder
