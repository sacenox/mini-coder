# mini-coder — Implementation Plan

A small, fast CLI coding agent built with Bun.js. Focused on developer flow,
elegant output, and a reliable core feature set.

---

## Setup

- Runtime: Bun.js
- Language: TypeScript (strict mode)
- Binary: `mc` (globally installable via `bun install -g .`)
- Config + sessions: `~/.config/mini-coder/`

---

## Dependencies

```
ai                         # AI SDK v6 core
@ai-sdk/anthropic          # Claude via Zen or direct
@ai-sdk/openai             # GPT via Zen or direct
@ai-sdk/google             # Gemini via Zen or direct
@ai-sdk/openai-compatible  # MiniMax, GLM, Kimi via Zen
ollama-ai-provider         # Local Ollama
yoctocolors                # ANSI colors (16-color safe, inherits terminal theme)
zod                        # Tool input schemas
```

---

## Provider Strategy

Uses the correct AI SDK package per endpoint type, following the OpenCode Zen docs:

| Provider                        | Package                    | Endpoint / Notes                              |
| ------------------------------- | -------------------------- | --------------------------------------------- |
| OpenCode Zen — Anthropic models | `@ai-sdk/anthropic`        | `https://opencode.ai/zen/v1/messages`         |
| OpenCode Zen — OpenAI models    | `@ai-sdk/openai`           | `https://opencode.ai/zen/v1/responses`        |
| OpenCode Zen — Google models    | `@ai-sdk/google`           | `https://opencode.ai/zen/v1/models/<model>`   |
| OpenCode Zen — OpenAI-compat    | `@ai-sdk/openai-compatible`| `https://opencode.ai/zen/v1/chat/completions` |
| Ollama (local)                  | `ollama-ai-provider`       | `http://localhost:11434` (auto-discovered)    |

### ENV Auto-discovery

| ENV var            | Effect                                    |
| ------------------ | ----------------------------------------- |
| `OPENCODE_API_KEY` | Enables OpenCode Zen provider             |
| `OLLAMA_BASE_URL`  | Override Ollama URL (default: localhost)  |

---

## Module Architecture

```
src/
  index.ts                # Entry point — CLI args, wires agent + session
  cli/
    input.ts              # Raw-mode stdin reader
                          #   - Line editing (left/right/backspace/ctrl-keys)
                          #   - History (up/down arrows, SQLite-backed)
                          #   - @ prefix → file reference autocomplete
                          #   - ! prefix → shell passthrough
    output.ts             # ANSI rendering
                          #   - Streaming text with cursor animation
                          #   - Tool call display (glob/grep/read → formatted args)
                          #   - Edit tool → unified diff output
                          #   - Shell tool → command + output block
                          #   - Status bar: model/provider/cwd/git branch/tokens
    commands.ts           # Slash command registry + handlers
                          #   - /model  → pick model from connected providers
                          #   - /plan   → toggle read-only plan mode
                          #   - /mcp    → list/add/remove MCP servers
                          #   - /review → subagent code review
  llm-api/
    providers.ts          # Provider factory
                          #   - ENV-based auto-discovery
                          #   - Returns LanguageModel for a given model ID string
                          #   - Supports "zen/claude-sonnet-4-6", "ollama/llama3", etc.
    turn.ts               # Single conversation turn
                          #   - streamText with tool loop (maxSteps)
                          #   - Yields streaming events: text delta, tool call, tool result
                          #   - Returns complete turn: messages + usage stats
    types.ts              # Shared types: Message, Turn, ToolCall, ProviderConfig
  agent/
    agent.ts              # Main agent REPL loop
                          #   - Reads input → calls turn → renders output → repeat
                          #   - Manages conversation history in memory + persists to DB
                          #   - Handles /plan mode (no tool execution)
                          #   - Abort on Ctrl+C mid-turn
    tools.ts              # Tool registry + hook system
                          #   - Registers all built-in tools
                          #   - Runs post-tool hooks (e.g. auto-format after edit)
  tools/
    glob.ts               # Glob pattern file discovery
    grep.ts               # Regex content search across files
    read.ts               # File read (with line range support)
    edit.ts               # File edit — exact string replacement (old → new)
    shell.ts              # Shell command execution with streaming stdout/stderr
    subagent.ts           # Spawn a nested mini-coder agent instance
  mcp/
    client.ts             # MCP server connection (stdio + HTTP transports)
    manager.ts            # Add/remove/list MCP servers, persist to config
  session/
    db.ts                 # bun:sqlite schema + query helpers
                          #   - sessions table: id, title, cwd, created_at, updated_at
                          #   - messages table: id, session_id, role, content, created_at
                          #   - prompt_history table: id, text, created_at
    manager.ts            # new / resume / list session operations
```

---

## Build Phases

### Phase 1 — Foundation

- [ ] `bun init` — project setup, `package.json`, `tsconfig.json`, `.gitignore`
- [ ] `session/db.ts` — SQLite schema and CRUD helpers
- [ ] `llm-api/types.ts` — shared type definitions
- [ ] `llm-api/providers.ts` — ENV-based provider factory
- [ ] `llm-api/turn.ts` — streaming turn with tool loop

### Phase 2 — Tools

- [ ] `tools/glob.ts` — glob file search
- [ ] `tools/grep.ts` — regex content search
- [ ] `tools/read.ts` — file read
- [ ] `tools/edit.ts` — file edit (string replace)
- [ ] `tools/shell.ts` — shell execution
- [ ] `tools/subagent.ts` — nested agent

### Phase 3 — CLI

- [ ] `cli/input.ts` — raw-mode line editor with history, `@`, `!`
- [ ] `cli/output.ts` — ANSI output, tool rendering, diffs, status bar
- [ ] `cli/commands.ts` — slash command handlers

### Phase 4 — Agent Loop

- [ ] `agent/tools.ts` — tool registry and hook system
- [ ] `agent/agent.ts` — main REPL loop
- [ ] `session/manager.ts` — session new/resume/list
- [ ] `src/index.ts` — entry point, CLI args (--new, --resume, --list)

### Phase 5 — MCP

- [ ] `mcp/client.ts` — MCP client (stdio + HTTP)
- [ ] `mcp/manager.ts` — `/mcp` command integration

---

## UI Design Notes

- Use only the 16 ANSI colors — colors inherit from the user's terminal theme
- No heavy box-drawing unless it reads well in monospace
- Status bar (always visible below input):
  `[model] [provider] [cwd] [git-branch] [ctx%] [↑tokens ↓tokens]`
- Tool call output format:
  - `glob "**/*.ts"` → compact tree of matched paths
  - `read src/foo.ts:10-30` → file + line range
  - `edit src/foo.ts` → unified diff (- old / + new)
  - `shell git status` → command + scrollable output block
- Prompt animation: simple spinner (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏) while LLM is running

---

## Configuration Schema

`~/.config/mini-coder/config.json`:

```json
{
  "defaultModel": "zen/claude-sonnet-4-6",
  "providers": {
    "zen": { "apiKey": "..." },
    "ollama": { "baseUrl": "http://localhost:11434" }
  },
  "mcpServers": [
    { "name": "exa", "transport": "http", "url": "https://..." }
  ]
}
```

---

## Out of Scope for v1

- LSP integration
- Image / screenshot support
- Web search tool

---

## Conventions

- Agent skill files: `.agents/` in project dir or `~/.config/mini-coder/agents/`
  (follows skills.sh convention)
- Context files: `AGENTS.md` or `CLAUDE.md` in project root (same as oh-my-pi / opencode)
- No mocked/offline tests — integration tests only against real providers
