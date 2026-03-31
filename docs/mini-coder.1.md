# MINI-CODER(1)

## NAME

**mini-coder** — a small, fast CLI coding agent (executable: `mc`)

## SYNOPSIS

`mc` \[_options_\] \[_prompt_\]

## DESCRIPTION

Developer-focused CLI coding agent. Prioritizes dev flow — no slow startup, no GUI, no vendor lock-in. Uses 16 ANSI colors to inherit terminal theme. Built on Bun.js.

## OPTIONS

`-m`, `--model` _id_
: Model to use (e.g. `zen/claude-sonnet-4-6`).

`-c`, `--continue`
: Continue most recent session.

`-r`, `--resume` _id_
: Resume a specific session.

`-l`, `--list`
: List recent sessions.

`--cwd` _path_
: Set working directory.

`-h`, `--help`
: Display help.

_prompt_
: Optional one-shot prompt. Runs once then exits.

## INTERACTIVE COMMANDS

`/model`
: List all available models.

`/model` _id_
: Switch model.

`/model effort` _low|medium|high|xhigh|off_
: Set reasoning effort.

`/session` \[_id_\]
: List sessions or switch to one.

`/new`
: Start a fresh session.

`/undo`
: Remove last turn (does NOT revert filesystem).

`/reasoning` \[_on|off_\]
: Toggle reasoning display.

`/verbose` \[_on|off_\]
: Toggle output truncation.

`/mcp list`
: List MCP servers.

`/mcp add` _name_ `http` _url_
: Add HTTP MCP server.

`/mcp add` _name_ `stdio` _cmd_ \[_args..._\]
: Add stdio MCP server.

`/mcp remove` _name_
: Remove MCP server.

`/login`
: Show OAuth login status.

`/login` _provider_
: Login via OAuth (opens browser for device flow). Currently supports `openai`.

`/logout` _provider_
: Clear saved OAuth tokens.

`/help`
: Command help.

`/exit`, `/quit`, `/q`
: Leave session.

## INLINE FEATURES

`!` prefix
: Runs shell commands inline — output is sent to the LLM as a user message.

`@` prefix
: Embeds a file into the prompt (Tab to complete file paths).

`/` prefix
: Reference a skill in the prompt (Tab to complete skill names).

## KEYS

`ESC`
: Interrupt the assistant response — partial output is preserved in history.

`Ctrl+C`
: Exit forcefully.

`Ctrl+D`
: Graceful exit (EOF).

`↑` / `↓`
: Navigate command history.

`Ctrl+R`
: Search command history.

## BUILT-IN TOOLS

**shell**
: Execute bash commands; repo inspection and `mc-edit` edits happen here.

**listSkills**
: List discovered skills (metadata only).

**readSkill**
: Load one SKILL.md on demand.

**webSearch**
: Search the web (requires `EXA_API_KEY`).

**webContent**
: Fetch page content (requires `EXA_API_KEY`).

MCP tools are connected dynamically from configured MCP servers.

## FILE EDITING — mc-edit

`mc-edit` is the helper for targeted file edits, invoked from **shell**.

```
mc-edit <path> (--old <text> | --old-file <path>) [--new <text> | --new-file <path>] [--cwd <path>]
```

- Applies one exact-text edit to an existing file.
- The old text must match exactly once.
- Omit `--new`/`--new-file` to delete the matched text.
- Success: prints unified diff + metadata (`ok`, `path`, `changed`).
- No-op: prints `(no changes)` + metadata.
- Errors go to stderr.

Workflow: inspect with **shell** → edit with **mc-edit** → verify with **shell**.

## SKILLS

Skills are reusable instruction files at `.agents/skills/<name>/SKILL.md`.

`.claude/skills/<name>/SKILL.md` is also supported.

**Frontmatter (both required):**

`name`
: Lowercase alphanumeric + hyphens, 1–64 chars.

`description`
: Help text.

Skills are auto discovered. To load explicitly:

- `/skill-name` in prompts (injects body as a user message).
- **listSkills** / **readSkill** tools at runtime.

Local discovery walks up from cwd to the git worktree root.

## CONFIGURATION

Config roots: `.agents/`, `.claude/` — local (repo) or global (`~/`).

**Context files** (global files first, then the nearest local directory with context files):

- Global files concatenate in this order: `~/.agents/AGENTS.md` → `~/.agents/CLAUDE.md` → `~/.claude/CLAUDE.md`
- Local files concatenate in this order within the nearest matching directory: `./.agents/AGENTS.md` → `./.agents/CLAUDE.md` → `./.claude/CLAUDE.md` → `./CLAUDE.md` → `./AGENTS.md`

**Precedence:**

1. Local context is loaded from the nearest directory between cwd and the git root.
2. Within one scope, matching files are concatenated in the order above.
3. Global context appears before local context in the system prompt.
4. Skills: nearest ancestor directory wins.

## ENVIRONMENT

`OPENCODE_API_KEY`
: OpenCode Zen (recommended).

`ANTHROPIC_API_KEY`
: Direct Anthropic.

`OPENAI_API_KEY`
: Direct OpenAI.

`GOOGLE_API_KEY` / `GEMINI_API_KEY`
: Direct Gemini.

`OLLAMA_BASE_URL`
: Ollama local (defaults to `http://localhost:11434`).

`EXA_API_KEY`
: Enables **webSearch** / **webContent**.

## FILES

`~/.config/mini-coder/`
: App data directory (sessions.db, with tables for error and other logs).

`.agents/` or `.claude/`
: Config directories for skills and context files.

`AGENTS.md` / `CLAUDE.md`
: Project context files.
