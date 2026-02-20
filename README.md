# 👾 mini-coder

> *Small. Fast. Gets out of your way.*

Hey there! I'm **mini-coder** — a CLI coding agent built for developers who want a sharp tool, not a bloated IDE plugin. Think of me as the pocket knife of AI coding assistants: lightweight, reliable, and always ready.

---

## 🤙 Who Am I?

I'm `mc` — your new terminal companion. I live in your shell, speak to large language models, and help you explore, understand, and modify code at the speed of thought.

I was built with a simple philosophy: **dev flow first**. No slow startup. No clunky GUI. No vendor lock-in. Just you, your terminal, and an AI that keeps up.

```
$ mc
┌─ mini-coder ──────────────────────────────────────────┐
│  What would you like to work on today?                │
│                                                       │
│  > _                                                  │
│                                                       │
│  [zen/claude-sonnet-4] [~/src/my-project] [main] ...  │
└───────────────────────────────────────────────────────┘
```

---

## 🛠️ What Can I Do?

I come equipped with a tight, reliable set of tools:

| Tool | What it does |
|---|---|
| 🔍 `glob` | Find files by pattern across your project |
| 🧲 `grep` | Search file contents with regex |
| 📖 `read` | Read files (with line-range support) |
| ✏️ `edit` | Make precise, targeted edits (no full rewrites) |
| 🐚 `shell` | Run shell commands and see their output |
| 🤖 `subagent` | Spawn a focused mini-me for parallel subtasks |

I can also connect to **MCP servers** (like Exa for web search), giving you superpowers on demand.

---

## ⚡ Key Features

- **Multi-provider, zero-config** — set `OPENCODE_API_KEY` and I'll auto-discover providers. Ollama running locally? I'll find that too.
- **Session memory** — conversations are saved in a local SQLite database. Resume where you left off.
- **Shell integration** — prefix with `!` to run shell commands inline. Use `@` to reference files in your prompt.
- **Slash commands** — `/model` to switch models, `/plan` for read-only thinking mode, `/review` for a code review, `/mcp` to manage MCP servers.
- **Beautiful, minimal output** — diffs for edits, formatted trees for file searches, a live status bar with model, git branch, and token counts.
- **16 ANSI colors only** — my output inherits *your* terminal theme. Dark mode, light mode, Solarized, Gruvbox — I fit right in.

---

## 🧠 Interesting Things About Me

- **I eat my own dog food.** I was built *by* a mini-coder agent. It's agents all the way down. 🐢
- **I'm tiny but mighty.** The whole runtime is [Bun.js](https://bun.com) — fast startup, native TypeScript, and a built-in SQLite driver.
- **I respect existing conventions.** Skill files live in `.agents/`, context in `AGENTS.md` or `CLAUDE.md` — I follow the ecosystem instead of inventing new standards.
- **I spin while I think.** ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ (It's the little things.)
- **I can clone myself.** The `subagent` tool lets me spin up parallel instances of myself to tackle independent subtasks simultaneously. Divide and conquer!

---

## 🚀 Getting Started

```bash
# Install globally
bun install -g .

# Set your provider key
export OPENCODE_API_KEY=your-key-here

# Launch!
mc
```

Or run directly for a quick task:

```bash
mc "Refactor the auth module to use async/await"
```

---

## 🗂️ Project Structure

```
src/
  index.ts          # Entry point
  agent/            # Main REPL loop + tool registry
  cli/              # Input, output, slash commands
  llm-api/          # Provider factory + streaming turn logic
  tools/            # glob, grep, read, edit, shell, subagent
  mcp/              # MCP server connections
  session/          # SQLite-backed session & history management
```

---

## 🔮 Tech Stack

- **Runtime:** [Bun.js](https://bun.com) — fast, modern, all-in-one
- **LLM routing:** [AI SDK](https://ai-sdk.dev) — multi-provider with streaming
- **Colors:** [yoctocolors](https://github.com/sindresorhus/yoctocolors) — tiny and terminal-theme-aware
- **Schema validation:** [Zod](https://zod.dev)
- **Storage:** `bun:sqlite` — zero-dependency local sessions

---

## 💬 Philosophy

> Accurate. Fast. Focused on the conversation.

I believe the best tools disappear into your workflow. I don't want to be the star of the show — I want *you* to ship great code, faster.

---

*Built with ❤️ and a healthy obsession with terminal aesthetics.*
