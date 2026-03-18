# mini-coder

A coding agent via a augmented shell prompt, small and fast that doesn't get in the way

## Inpirations:

- Pi agent: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent amazing tool, like a swiss army knife of coding agents.
- Claude Code: https://claude.com/product/claude-code clean UI, propertary software
- Codex: https://github.com/openai/codex Powerful and open source, focused on heavy open-ai integration
- Opencode: https://opencode.ai/ The open source standard. Similar to oh-my-pi but with a different aesthetic

We want to do our best to support their configs, try to find the common api and auto load them along with the community .agents conventions.

## Philosophy:

**Fast and performant**, instant feedback shell like output. Performance first style second.

Very focused on dev flow, simple setup steps and fast to coding.
Elegant output that focus on the conversation with the agent and their actions. Ensure an accurate cronological conversation log that is very readable for the user. Keep a visible hierchy of actions -> results and assistant reasoning and responses.
Accurate and reliable and fast core set of features.
Community oriented, all of the inspirations have their own dotfile format, try to follow the existing
conventions and not introduce more specs. (`.agents` / `AGENTS.md`, while also supporting adjacent conventions like `.claude`)

## Features:

- Auto discovery of providers via ENV (Example: OPENCODE_API_KEY), or local servers (Example: ollama)
- Session management and command to create new/resume/list with local sqlite file.
- Rich line editing/history/image paste
- Seamless shell integration with `!` in prompt input.
- Reference files and skills from the working directory and global configs with `@` in prompt input, plus autocomplete for files, skills, to include in the prompt. Skills should have their respective tools and implementation to match other coding agents
- Press `ESC` at any point during an assistant response to interrupt it: the partial response is preserved in history with an interrupt stub appended (so the LLM retains context), and the user is returned to the prompt silently. `ctrl+c` exits forcefully. `ctrl+d` (EOF) gracefully exits.
- Elegantly handles hitting max context size for the model using regular pruning.
- No max steps or max tool calls. user can interrupt, this is not needed.
- Support prompt caching via the used sdks.
- Feature parity with community configs like custom agents, skill and commands.
- Shell-first tool surface for LLMs: `shell`, `listSkills`, and `readSkill`, plus connected MCP tools and optional web tools when configured. Keep the core surface small and easy to use so it actually reduces friction for the LLMs.
- File work should follow a simple flow: inspect with shell, mutate with `mc-edit`, verify with shell.
- Large shell outputs should be truncated automatically for the llm, to avoid context explosions and encourage targetted reads.
- `mc-edit` should stay narrow and reliable: exact-text edits only, deterministic failures on stale or ambiguous state, diff and machine-friendly output while staying human readable.
- Optional `webSearch` and `webContent` tools when `EXA_API_KEY` is set.
- Commands in CLI prompt:
  - `/model` (alias `/models`) command allows the user to pick a model from connected providers. As well as thinking effort for the model if supported. Selection persists accross sessions.
  - `/undo` removes the last turn from conversation history, it does not restore filesystem state.
  - `/reasoning` toggles display of model reasoning output.
  - `/verbose` toggles output truncation. Tuncates large outputs keeping start and end sections and truncating the rest when verbose is off. This controls truncation for the user output, it's a visibility UI concern
  - `/context` configures context pruning and tool-result caps.
  - `/review` reviews recent changes via a global custom command installed at app start (`~/.agents/commands/review.md`), and can be customized or shadowed locally.
  - `/agent` sets or clears the active agent.
  - `/mcp` list/add/remove mcp servers. servers are stored in sqlite
  - `/login` shows OAuth login status. `/login <provider>` starts browser-based OAuth login. `/logout <provider>` clears saved tokens. Currently supports Anthropic.
  - `/new` starts a new session with clean context. Clean UI and fresh session display
- Connect to MCP servers over Streamable HTTP / SSE fallback or stdio.
- Image support in prompt input, including pasted image data URLs and pasted image file paths.
- Excellent auto complete for all commands, subtituitions. The user should also be able to reference files with autocomplete wihtout including them into the prompt like `@` does with TAB

## UI/Output

- Use the 16 ANSII colors so the coloring is allways inherited from the terminal theme (https://jvns.ca/blog/2024/10/01/terminal-colours/)
- Use pi and claude code as visual inspirations.
- Banner at app start, show found configs and context files
- history log (like a terminal output scrolls away, pushing the input prompt down)
  - Skill tools show compact metadata-oriented output
  - Shell tool shows the command called and its output
  - MCP tools stay clearly distinguishable from shell work
- status bar like prompt, with current model/provider/session/git branch/active agent/thinking effort/context usage/token input/token output
- some prompt colored animation when a turn is processing. Needs to be carefully done, so it shows correctly in wait times and with clear labels

## Tech stack

- All things Bun.js, runtime, package manager. https://bun.com/docs
- Multiprovider support via https://ai-sdk.dev/docs/introduction
- Colored output with https://github.com/sindresorhus/yoctocolors limitted but fast!

## Repo structure

Clean separation of concerns, use modules to organize the app. Group logical features together for best browsability and readability of the code. Use subdirectories to group files logically.
No mocked/offline-servers type of tests. Focused tests on _our_ logic. Do not test our dependencies.

Core modules:

- `llm-api`: Provides the api to intereact with the provider and process the full conversation turn + tool calling.
- `cli`: Output/UI, with logical separated subfolder: user input/output and ui/etc..
- `agent`: Main agent implementation
- `tools`: shell, skill, and web/search helpers
- `session`: sqlite-backed sessions, settings, model info, and MCP server storage
- `mcp`: handles connecting to mcp servers
