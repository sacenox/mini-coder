<p align="center">
  <img src="assets/icon-5-community-badge.svg" alt="mini-coder logo" width="100" height="100"/>
</p>

# 👾 mini-coder

> _Small. Fast. Gets out of your way._

[📖 Read the Full Manual](docs/mini-coder.1.md)

A terminal coding agent for developers who want a sharp tool, not a bloated IDE plugin. Shell-first, multi-provider, minimal tool surface. Just you, your terminal, and an AI that keeps up.

<p align="center">
  <img src="./assets/preview.gif" alt="Minicoder Preview"/>
</p>

---

## ⚡ Quick Start

I run on [Bun](https://bun.com) — install me via bun or npm, but Bun needs to be on your machine.

```bash
# Install
bun add -g mini-coder   # or: npm install -g mini-coder

# Set one API key (pick any)
export OPENCODE_API_KEY=your-key     # recommended
export ANTHROPIC_API_KEY=your-key    # direct Anthropic
export OPENAI_API_KEY=your-key       # direct OpenAI
export GOOGLE_API_KEY=your-key       # direct Gemini (or GEMINI_API_KEY)

# Optional
export OLLAMA_BASE_URL=http://localhost:11434   # local models
export EXA_API_KEY=your-key                     # web search tools

# Go
mc
```

One-shot mode: `mc "refactor auth to use async/await"` — runs once, then exits.

Useful flags: `-c` continue last session, `-r <id>` resume, `-l` list sessions, `-m <model>` pick a model, `-h` help.

---

## 🔑 OAuth Login

Use `/login` inside the REPL to authenticate via browser-based OAuth. Currently supported: `openai` (`/login openai` uses the Codex / ChatGPT Plus/Pro flow). No need to manage API keys manually.

---

## 🛠️ Features

- **Multi-provider** — supports Anthropic, OpenAI (direct + OAuth), Gemini, and Ollama
- **Session memory** — SQLite-backed. Resume with `-c` or `-r <id>`
- **Shell integration** — `!` prefix for inline commands, `@` to reference files with tab completion
- **Web search** — `webSearch` + `webContent` tools when `EXA_API_KEY` is set
- **MCP support** — connect external tool servers over HTTP or stdio
- **Skills** — `.agents/skills/<name>/SKILL.md`, invoke with `/skill-name` in the prompt
- **`mc-edit`** — safe, exact-text file editing (no full-file rewrites)
- **16 ANSI colors** — inherits your terminal theme. Always looks right.

---

## 📚 Getting Deeper

The README is the highlight reel. For the full story — slash commands, config folders, context files, app data, and everything else:

**[📖 Read the Full Manual](docs/mini-coder.1.md)**

---

## 🔮 Tech Stack

[Bun.js](https://bun.com) · [AI SDK](https://ai-sdk.dev) · [yoctocolors](https://github.com/sindresorhus/yoctocolors)

## 📄 License

MIT — [github.com/sacenox/mini-coder](https://github.com/sacenox/mini-coder)
