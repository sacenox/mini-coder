# MINI-CODER(1)

## NAME

**mini-coder** — a small, fast CLI coding agent (executable: `mc`)

## SYNOPSIS

`mc` \[*options*\] \[*prompt*\]

## DESCRIPTION

Developer-focused CLI coding agent. Prioritizes dev flow — no slow startup, no GUI, no vendor lock-in. Uses 16 ANSI colors to inherit terminal theme. Built on Bun.js.

## OPTIONS

`-m`, `--model` *id*
: Model to use (e.g. `zen/claude-sonnet-4-6`).

`-c`, `--continue`
: Continue most recent session.

`-r`, `--resume` *id*
: Resume a specific session.

`-l`, `--list`
: List recent sessions.

`--cwd` *path*
: Set working directory.

`-h`, `--help`
: Display help.

*prompt*
: Optional one-shot prompt. Runs once then exits.

## INTERACTIVE COMMANDS

`/model`
: List all available models.

`/model` *id*
: Switch model.

`/model effort` *low|medium|high|xhigh|off*
: Set reasoning effort.

`/reasoning` \[*on|off*\]
: Toggle reasoning display.

`/context prune` *off|balanced|aggressive*
: Pruning strategy.

`/context cap` *off|bytes|kb*
: Tool result payload cap.

`/cache` *on|off*
: Toggle prompt caching globally.

`/cache openai` *in_memory|24h*
: OpenAI cache retention.

`/cache gemini` *off|cachedContents/...*
: Gemini cached content.

`/undo`
: Remove last turn (does NOT revert filesystem).

`/new`
: Start a fresh session.

`/verbose`
: Toggle output truncation.

`/mcp list`
: List MCP servers.

`/mcp add` *name* `http` *url*
: Add HTTP MCP server.

`/mcp add` *name* `stdio` *cmd* \[*args...*\]
: Add stdio MCP server.

`/mcp remove` *name*
: Remove MCP server.

`/agent` \[*name*\]
: Set or clear active primary agent.

`/review`
: Review changes (custom command, auto-created globally).

`/login`
: Show OAuth login status.

`/login` *provider*
: Login via OAuth (opens browser for device flow). Currently supports `anthropic`.

`/logout` *provider*
: Clear saved OAuth tokens.

`/help`
: Command help.

`/exit`, `/quit`, `/q`
: Leave session.

## INLINE FEATURES

`!` prefix
: Runs shell commands inline.

`@` prefix
: References files or skills (with tab completion).

## BUILT-IN TOOLS

**shell**
: Execute bash commands; repo inspection and `mc-edit` edits happen here.

**subagent**
: Spawn a focused mini-agent for parallel subtasks.

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

## CUSTOM COMMANDS

Drop a `.md` file in `.agents/commands/` (local) or `~/.agents/commands/` (global) and it becomes a `/command`. Filename equals command name (`standup.md` → `/standup`).

`.claude/commands/*.md` is also supported.

**Frontmatter fields:**

`description`
: Shown in `/help`.

`model`
: Override model (only with `context: fork`).

`context`
: `fork` to run as isolated subagent; default is inline.

`subtask`
: `true` forces subagent (OpenCode-compatible alias).

`agent`
: Run under named agent's system prompt (only with `context: fork`).

**Argument substitution:**

`$ARGUMENTS` expands to the full argument string; `$1`–`$9` expand to positional tokens.

**Shell interpolation:**

`` !`cmd` `` injects shell output at expansion time (10 s timeout).

**Precedence:** custom commands shadow built-ins. Local overrides global.

## CUSTOM AGENTS

Drop a `.md` file in `.agents/agents/` (local) or `~/.agents/agents/` (global). Filename equals agent name. Activate with `/agent <name>`.

`.claude/agents/*.md` is also supported.

**Frontmatter fields:**

`description`
: Shown in `/help`.

`model`
: Override active model.

`mode`
: `primary` excludes from subagent tool; `subagent`/`all`/omitted keeps it available.

Body is the agent system prompt. Non-primary agents are exposed to the **subagent** tool for delegation.

## SKILLS

Skills are reusable instruction files at `.agents/skills/<name>/SKILL.md`.

`.claude/skills/<name>/SKILL.md` is also supported.

**Frontmatter (both required):**

`name`
: Lowercase alphanumeric + hyphens, 1–64 chars.

`description`
: Help text.

Skills are never auto-loaded. Load explicitly:

- `@skill-name` in prompts (injects body wrapped in `<skill>` XML).
- **listSkills** / **readSkill** tools at runtime.

Local discovery walks up from cwd to the git worktree root.

## CONFIGURATION

Supports `.agents` and `.claude` layouts for commands, skills, agents, and context.

Config roots: `.agents/`, `.claude/` — local (repo) or global (`~/`).

**Context files** (one global + one local loaded):

- Global: `~/.agents/AGENTS.md` → `~/.agents/CLAUDE.md`
- Local: `./.agents/AGENTS.md` → `./CLAUDE.md` → `./AGENTS.md`

**Precedence:**

1. Local overrides global.
2. Same scope: `.agents` wins over `.claude`.
3. Skills: nearest ancestor directory wins.

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
: App data directory (sessions.db, api.log, errors.log).

`.agents/` or `.claude/`
: Config directories for commands, agents, skills.

`AGENTS.md` / `CLAUDE.md`
: Project context files.
