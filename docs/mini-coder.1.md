# MINI-CODER(1)

## NAME
**mini-coder** (executable: `mc`) - A small, fast CLI coding agent built for developers.

## SYNOPSIS
`mc [options] [prompt]`

## DESCRIPTION
**mini-coder** is a developer-focused CLI coding agent. It prioritizes developer flow with no slow startup, no clunky GUI, and no vendor lock-in. It uses a minimalist terminal UI restricted to 16 ANSI colors to inherit the user's terminal theme, and is built entirely on Bun.js for maximum performance.

## OPTIONS
**-m, --model <id>**
:   Specify the model to use (e.g., `zen/claude-sonnet-4-6`).

**-c, --continue**
:   Continue the most recent session.

**-r, --resume <id>**
:   Resume a specific session by its ID.

**-l, --list**
:   List recent sessions.

**--cwd <path>**
:   Set the working directory (defaults to current directory).

**-h, --help**
:   Display help information.

**[prompt]**
:   Optional one-shot prompt text. Runs once, then exits.

## INTERACTIVE COMMANDS
Inside the interactive session, the following slash commands are available:

**/model**
:   List all available models, indicating free models and context sizes.

**/model <id>**
:   Switch to a specific model.

**/model effort <low|medium|high|xhigh|off>**
:   Configure reasoning effort levels for models that support it.

**/reasoning [on|off]**
:   Toggle the display of the model's reasoning/thought process.

**/context prune <off|balanced|aggressive>**
:   Configure context window pruning strategies.

**/context cap <off|bytes|kb>**
:   Set a hard payload cap size for tool results to avoid blowing out context.

**/cache <on|off>**
:   Toggle prompt caching globally.

**/cache openai <in_memory|24h>**
:   Set OpenAI prompt cache retention policies.

**/cache gemini <off|cachedContents/...>**
:   Attach Google Gemini cached content.

**/undo**
:   Remove the last conversation turn. This does not revert filesystem changes.

**/new**
:   Clear context and start a fresh session.

**/mcp list**
:   List configured MCP servers.

**/mcp add <name> http <url>**
:   Add an MCP server over HTTP.

**/mcp add <name> stdio <cmd> [args...]**
:   Add an MCP server over stdio.

**/mcp remove <name>** (or **rm**)
:   Remove an MCP server.

**/agent [name]**
:   Set or clear an active primary custom agent.

**/review**
:   Custom command that reviews the current session's changes (defined via `.agents/commands/`).


**/help**
:   Display command help.

**/exit, /quit, /q**
:   Leave the session.

## INLINE FEATURES
**Shell Integration**
:   Prefix user prompts with `!` to run shell commands inline directly into the context.

**File & Skill Referencing**
:   Prefix words with `@` to reference files or skills within prompts (supports tab completion).

## BUILT-IN TOOLS
The agent has access to the following tools:
*   **shell**: Execute bash commands and capture output. Repo inspection and targeted file edits are typically done here via `mc-edit`.
*   **subagent**: Spawn a focused mini-agent with a prompt.
*   **listSkills**: List discovered skills without loading full skill bodies.
*   **readSkill**: Load one `SKILL.md` on demand.
*   **webSearch**: Search the internet (requires EXA key).
*   **webContent**: Fetch full page content from a URL (requires EXA key).
*   **MCP tools**: Connected external tools attached dynamically from configured MCP servers.

## FILE EDIT HELPER
**mc-edit**
:   Helper command used from shell for one exact-text edit on an existing file. On success it prints a human-readable plain unified diff to stdout followed by a short metadata block (`ok`, `path`, `changed`). If the edit is a no-op, it prints `(no changes)` plus the same metadata. Errors are written to stderr.

## ENVIRONMENT
**OPENCODE_API_KEY**
:   OpenCode Zen API key (Recommended provider).

**ANTHROPIC_API_KEY**
:   Direct Anthropic API key.

**OPENAI_API_KEY**
:   Direct OpenAI API key.

**GOOGLE_API_KEY** (or **GEMINI_API_KEY**)
:   Direct Google Gemini API key.

**OLLAMA_BASE_URL**
:   Ollama local base URL (Defaults to `http://localhost:11434`).

**EXA_API_KEY**
:   Enables built-in `webSearch` and `webContent` tools.

## FILES & DIRECTORIES
**~/.config/mini-coder/**
:   Application data directory. Contains `sessions.db` (SQLite database for session history, MCP server configs, and model metadata), `api.log`, and `errors.log`.

**.agents/ or .claude/ (Local or Global in ~/)**
:   Configuration directories for advanced features:
    *   **commands/*.md**: Custom slash commands.
    *   **agents/*.md**: Custom behavioral wrappers or subagents.
    *   **skills/<name>/SKILL.md**: Isolated context/instruction snippets.

**AGENTS.md / CLAUDE.md**
:   Auto-loaded system context files for project-specific instructions.

## CORE FEATURES & ARCHITECTURE
*   **Multi-Provider LLM Routing**: Automatically discovers API keys to route to OpenCode (Zen), Anthropic, OpenAI, Google/Gemini, or local Ollama instances.
*   **Session Memory**: Persists conversation history in a local SQLite database, allowing users to resume past sessions effortlessly.
*   **Subagent Delegation**: Includes a tool to spawn parallel instances of itself to tackle independent subtasks simultaneously (up to 10 levels deep).
*   **Model Context Protocol (MCP)**: Native support for connecting external tools via MCP servers over HTTP or stdio.
*   **Prompt Caching**: Configurable caching behaviors for supported providers (OpenAI, Gemini).
*   **Undo Functionality**: Remove the last conversation turn from the current session history. It does not restore filesystem changes.


