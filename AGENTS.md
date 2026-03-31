# Mini Coder repo for agents:

- App data folder is in `~/.config/mini-coder/`. It includes sqlite db file and logs.
- README.md is cosmetic for users, don't edit unless asked to.
- `docs/KNOWN_ISSUES.md` tracks known issues. `docs/mini-coder.1.md` is the man page.
- Create or reuse the `TODO.md` file to track your progress in long tasks. Remove completed items, keep it clean, concise, and up to date at all times. Track it in git.
- Write minimal tests, focused on our code's logic. Never test dependencies. Never use mocks or stubs.
- Keep the repo pristine: no failing tests, no lint, no build issues, no `ignore`-style comments. No failing hooks.
- Verify your changes, you can use the shell tool and `tmux` to test as needed.
- **tmux send-keys rules**: always use `-l` for text (`tmux send-keys -t s -l 'text'`), then send `Enter` separately without `-l` (`tmux send-keys -t s Enter`). Without `-l`, words like `Enter`, `Escape`, `Tab`, `Space` are interpreted as key presses.
- Use `bun run format` to fix formatting issues.
- We care about performance.
- Do not inline `import` calls. Don't duplicate code. Don't leave dead code behind.
- Don't re-implement helpers/functionality that already exists, always consolidate.
- Don't add complexity for backwards compatibility, it's preferable to break compatibility and keep the code simple.
- Don't make random test files, if you need to test something, write a proper unit test.
- If you make temp files, clean them up when you are done.
- Before committing, run `git status` and ensure every modified and untracked file produced during the session is included. Do not leave files behind.
- Use Conventional Commits formatting for commit messages.
- Before committing code changes, review the diff with the user and get approval for the commit. Treat direct user requests to commit or to do repository tasks as approval.

## Core idea, treat this as the source of truth for the design/implementation.

mini-coder - `mc`

An augmented shell prompt coding agent — small, fast, stays out of the way.

### Inspirations:

- Pi agent: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent
- Claude Code: https://claude.com/product/claude-code
- Codex: https://github.com/openai/codex
- Opencode: https://opencode.ai/

### Philosophy:

**Performance first, style second.** Instant feedback, shell-like output.

Focused on dev flow — minimal setup, fast to coding.
Output is a scrolling chronological log, append only with full streaming visibility to the user: actions → results → reasoning → responses. No redraws, no clearing — append-only like a terminal. Exception: `/new` clears the screen for a fresh start.
Core features must be correct and fast before adding new ones.
Community oriented — support AGENTS.md and agentskills.io specs, don't introduce new config formats.

### Features:

- Autodiscover and load community config standards on startup:
  - AGENTS.md / CLAUDE.md → https://agents.md/
  - Skills (`.agents/skills/` and `.claude/skills/`) → https://agentskills.io/client-implementation/adding-skills-support

- Auto discovery of providers via ENV (Example: OPENCODE_API_KEY), or local servers (Example: ollama)
  - `/login` shows OAuth login status. `/login <provider>` starts browser-based OAuth login. `/logout <provider>` clears saved tokens. Currently supports OpenAI (`openai` uses the Codex / ChatGPT Plus/Pro flow). Anthropic support was removed to comply to their TOS, we can't impersonate claude.
  - `/model` (alias `/models`) picks a model from connected providers, including thinking effort if supported. Selection persists across sessions with autocomplete.

- Session management and command to create new/resume/list with local sqlite file.
  - `/session` command to interactively manage sessions as well as cli flags.
  - `/new` starts a new session with empty message history, clears the screen, and redraws the banner.

- Enriched user prompt:
  - Rich line editing/history/image paste. Enter submits.
  - Seamless shell integration with `!` in prompt input. Runs command in subprocess and sends the output to the llm as user message.
  - Reference skills from the working directory and global configs with `/` in prompt input, plus autocomplete for skills to include in the prompt.
  - Press `ESC` at any point during an assistant response to interrupt it: the partial response is preserved in history with an interrupt stub appended (so the LLM retains context), and the user is returned to the prompt silently. `ctrl+c` exits forcefully. `ctrl+d` (EOF) gracefully exits.
  - Image support in prompt input, including pasted image data URLs and pasted image file paths.
  - Shell like autocomplete for filepaths, `@` embeds a file into the prompt and autocompletes filepaths

- Context handling:
  - Rolling context pruning per step; stops with a conversation summary at max context. Must not break prompt caching.
  - No max steps or tool call limits — user can interrupt.
  - Clear, accurate token tracking.
  - On error, log it, display a one-line summary to the user, and return to the input prompt.
  - `/undo` removes the last turn from history (does not restore filesystem).

- Shell-first tool surface: `shell`, `listSkills`, `readSkill`, plus connected MCP tools and optional web tools (`EXA_API_KEY`). Keep it small.
  - Inspect with shell → mutate with `mc-edit` → verify with shell.
  - Auto-truncate large shell outputs for the LLM to avoid context explosions.
  - `mc-edit`: exact-text edits only, deterministic failures on stale/ambiguous state.
  - Single system prompt that works across all supported models (no provider-specific branches).

- Other Commands in CLI prompt:
  - `/reasoning` toggles display of model reasoning output.
  - `/verbose` toggles output truncation. When off, large outputs keep start/end sections and truncate the middle. UI-only visibility concern.

- Connect to MCP servers over Streamable HTTP / SSE fallback or stdio.
  - `/mcp` list/add/remove mcp servers. servers are stored in sqlite

### UI/Output

- Use the 16 ANSI colors so coloring is always inherited from the terminal theme (https://jvns.ca/blog/2024/10/01/terminal-colours/)
- Use pi and claude code as visual inspirations.
- Banner at app start listing discovered AGENTS.md files, context files, and provider status.
- Append-only scrolling log (new output pushes the input prompt down, nothing is redrawn):
  - Skill tools: one-line name + description, no body content.
  - Shell tool: the command, then its stdout/stderr.
  - MCP tools: prefixed with server name to distinguish from built-in tools.
- Status bar above the input prompt showing: model, provider, session id, git branch, thinking effort, context %, input tokens, output tokens.
- Inline spinner with a label (e.g. "thinking", "running shell") while waiting for LLM or tool responses. Must not interfere with scrollback or leave artifacts on interrupt.

### Tech stack

- All things Bun.js, runtime, package manager. https://bun.com/docs
- Multiprovider support via https://ai-sdk.dev/docs/introduction
- Colored output with https://github.com/sindresorhus/yoctocolors — limited but fast.

### Repo structure

One directory per module (e.g. `cli/`, `agent/`, `session/`, `tools/`, `llm-api/`). Each directory owns its types, logic, and tests — no cross-module circular imports.
Tests live next to the code they test (`foo.test.ts` beside `foo.ts`). No mock servers, no dependency tests — test only our logic.
