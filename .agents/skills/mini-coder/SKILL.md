---
name: mini-coder
description: Architecture and conventions for the mini-coder codebase
---

# mini-coder

mini-coder is a small, fast CLI coding agent built with Bun and TypeScript.

## Key source paths

| Path | Purpose |
|------|---------|
| `src/agent/` | Core agent loop, session runner, subagent runner, system prompt builder |
| `src/cli/` | CLI commands, custom commands, agents/skills loaders, input/output rendering |
| `src/llm-api/` | Provider abstraction, turn streaming, model metadata |
| `src/tools/` | All tools (read, replace, insert, create, shell, subagent, exa, …) |
| `src/session/` | Session manager and SQLite DB repositories |
| `src/mcp/` | MCP client integration |
| `.agents/` | Local config: agents, commands, skills, hooks |

## Config system

All config lives under `.agents/` (or `~/.agents/` globally). Local wins over global; within the same scope, `.agents/` wins over `.claude/`.

| Type | Path | Strategy |
|------|------|----------|
| Agents | `.agents/agents/<name>.md` | flat — one `.md` per agent |
| Commands | `.agents/commands/<name>.md` | flat — one `.md` per command |
| Skills | `.agents/skills/<name>/SKILL.md` | nested — one directory per skill |

### Frontmatter fields

- `description` — shown in `/help` and agent/skill listings
- `model` — override the LLM model for this config (commands: only used when `context: fork`)
- `mode` — `primary` / `subagent` / `all` (agents only; default: `subagent`)
- `agent` — run command under a named agent's system prompt (commands: only used when `context: fork`)
- `name` — override the key name (nested skills only; defaults to folder name)
- `context` — `fork` to run command as isolated subagent; default is inline in current conversation (commands only; Claude Code standard)
- `subtask` — `true` to force subagent invocation (commands only; OpenCode compat, equivalent to `context: fork`)

### Agent modes

- `primary` — activated interactively via `/agent <name>` in the CLI
- `subagent` — callable via the `subagent` tool (the default when `mode` is omitted)
- `all` — available in both contexts

## Tools

Every tool is declared in `src/agent/tools.ts`. Core tools: `read`, `replace`, `insert`, `create`, `shell`, `subagent`, `webSearch`, `webContent`.

Hooks in `.agents/hooks/` fire after any of the 5 hookable tools: `read`, `create`, `replace`, `insert`, `shell`. The repo currently uses `post-create`, `post-insert`, and `post-replace` to auto-format changed files.


## Testing

```
bun run jscpd && bun run knip && bun run typecheck && bun run format && bun run lint && bun test
```

Tests are `*.test.ts` files co-located with source. Write minimal tests focused on our own logic — no mocks, no stubs, no mock servers.

## Data

App data: `~/.config/mini-coder/` — SQLite DB for sessions, model info, MCP servers, and settings.
