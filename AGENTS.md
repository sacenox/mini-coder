# Mini Coder repo for agents:

- App data folder is in `~/.config/mini-coder/`. It includes sqlite db file and logs.
- README.md is cosmetic for users, don't edit unless asked to.
- Known issues are in `docs` as well as the other man-like document about mini-coder.
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
- Don't make random test files, if you need to test something, write a propper unit test.
- If you make temp files, clean them up when you are done.
- Use Conventional Commits formatting for commit messages. When you commit, include the whole diff unless told otherwise.
- Always use your superpowers skills effectively.

## Core idea, treat this as the source of truth for the design/implementation.

mini-coder - `mc`

A coding agent via a augmented shell prompt, small and fast that doesn't get in the way

### Inpirations:

- Pi agent: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent amazing tool, like a swiss army knife of coding agents.
- Claude Code: https://claude.com/product/claude-code clean UI, propertary software
- Codex: https://github.com/openai/codex Powerful and open source, focused on heavy open-ai integration
- Opencode: https://opencode.ai/ The open source standard. Similar to oh-my-pi but with a different aesthetic

### Philosophy:

**Fast and performant**, instant feedback shell like output. Performance first style second.

Very focused on dev flow, simple setup steps and fast to coding.
Elegant output that focus on the conversation with the agent and their actions. Ensure an accurate cronological conversation log that is very readable for the user. Keep a visible hierchy of actions -> results and assistant reasoning and responses.
Accurate and reliable and fast core set of features.
Community oriented, all of the inspirations have their own dotfile format, try to follow the existing
conventions and not introduce more specs.

### Features:

- We want to do our best to support and autodiscover community config standards:
  - AGENTS.md -> https://agents.md/
    - CLAUDE.md (same as AGENTS.md)
  - Skills -> https://agentskills.io/client-implementation/adding-skills-support (and https://agentskills.io/client-implementation/adding-skills-support.md, https://agentskills.io/llms.txt)
    - Claude skills too. They claim to follow the spec, we should only need to discover them too.

- Auto discovery of providers via ENV (Example: OPENCODE_API_KEY), or local servers (Example: ollama)
  - `/login` shows OAuth login status. `/login <provider>` starts browser-based OAuth login. `/logout <provider>` clears saved tokens. Currently supports Anthropic. (Both pi and opencode support this too)
  - `/model` (alias `/models`) command allows the user to pick a model from connected providers. As well as thinking effort for the model if supported. Selection persists accross sessions. Must have autocomplete support for ease of use when changing models

- Session management and command to create new/resume/list with local sqlite file.
  - `/session` command to interactively manage sessions as well as cli flags.
  - `/new` starts a new session with clean context. Clean UI and fresh session display

- Enriched user prompt:
  - Rich line editing/history/image paste. Enter submits.
  - Seamless shell integration with `!` in prompt input. Runs command in subprocess and sends the output to the llm as user message.
  - Reference skills from the working directory and global configs with `/` in prompt input, plus autocomplete for skills to include in the prompt.
  - Press `ESC` at any point during an assistant response to interrupt it: the partial response is preserved in history with an interrupt stub appended (so the LLM retains context), and the user is returned to the prompt silently. `ctrl+c` exits forcefully. `ctrl+d` (EOF) gracefully exits.
  - Image support in prompt input, including pasted image data URLs and pasted image file paths.
  - Shell like autocomplete for filepaths, `@` embeds a file into the prompt and autocompletes filepaths

- Context handling:
  - Elegantly handles hitting max context size for the model using regular per step pruning. Stops with a conversation summary if max context is reached.
  - No max steps or max tool calls. user can interrupt, this is not needed.
  - Support prompt caching via the used sdks.
  - Rolling context pruning with a balanced default. (Must not break caching!)
  - Clear and accurate token tracking.
  - Recover from errors returning the user to the prompt with clear messaging
  - `/undo` removes the last turn from conversation history, it does not restore filesystem state.

- Shell-first tool surface for LLMs: `shell`, `listSkills`, and `readSkill`, plus connected MCP tools and optional web tools when configured. Keep the core surface small and easy to use so it actually reduces friction for the LLMs.
  - File work should follow a simple flow: inspect with shell, mutate with `mc-edit`, verify with shell.
  - Large shell outputs should be truncated automatically for the llm, to avoid context explosions and encourage targetted reads.
  - `mc-edit` should stay narrow and reliable: exact-text edits only, deterministic failures on stale or ambiguous state, diff and machine-friendly output while staying human readable.
  - Optional `webSearch` and `webContent` tools when `EXA_API_KEY` is set.
  - Cross model system prompt with clear descriptions of the expected dev flow and guidance as a code agent focused on shell first.

- Other Commands in CLI prompt:
  - `/reasoning` toggles display of model reasoning output.
  - `/verbose` toggles output truncation. Tuncates large outputs keeping start and end sections and truncating the rest when verbose is off. This controls truncation for the user output, it's a visibility UI concern
  - `/review` reviews recent changes via a global custom skill installed at app start (`~/.agents/skills/review.md`), and can be customized or shadowed locally.

- Connect to MCP servers over Streamable HTTP / SSE fallback or stdio.
  - `/mcp` list/add/remove mcp servers. servers are stored in sqlite

### UI/Output

- Use the 16 ANSII colors so the coloring is allways inherited from the terminal theme (https://jvns.ca/blog/2024/10/01/terminal-colours/)
- Use pi and claude code as visual inspirations.
- Banner at app start, show found configs and context files
- history log (like a terminal output scrolls away, pushing the input prompt down)
  - Skill tools show compact metadata-oriented output
  - Shell tool shows the command called and its output
  - MCP tools stay clearly distinguishable from shell work
- status bar like prompt, with current model/provider/session/git branch/thinking effort/context usage/token input/token output information grouped logically and human readable.
- some prompt colored animation when a turn is processing. Needs to be carefully done, so it shows correctly in wait times and with clear labels

### Tech stack

- All things Bun.js, runtime, package manager. https://bun.com/docs
- Multiprovider support via https://ai-sdk.dev/docs/introduction
- Colored output with https://github.com/sindresorhus/yoctocolors limitted but fast!

### Repo structure

Clean separation of concerns, use modules to organize the app. Group logical features together for best browsability and readability of the code. Use subdirectories to group files logically.
No mocked/offline-servers type of tests. Focused tests on _our_ logic. Do not test our dependencies.
