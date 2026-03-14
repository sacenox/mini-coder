# mini-coder

A coding agent via a augmented shell prompt, small and fast that doesn't get in the way

## Inpirations:

- Oh my pi: https://github.com/can1357/oh-my-pi amazing tool, like a swiss army knife of coding agents.
- Claude Code: https://claude.com/product/claude-code clean UI, propertary software
- Codex: https://github.com/openai/codex Powerful and open source, focused on heavy open-ai integration
- Opencode: https://opencode.ai/ The open source standard. Similar to oh-my-pi but with a different aesthetic

## Philosophy:

Very focused on dev flow, simple setup steps and fast to coding.
Elegant output that focus on the conversation with the agent and their actions. Ensure an accurate cronological conversation log that is very readable for the user. Keep a visible hierchy of actions -> results and assistant reasoning and responses.
Accurate and reliable core set of features.
Fast and performant, instant feedback shell like output. Performance first style second.
Community oriented, all of the inspirations have their own dotfile format, try to follow the existing
conventions and not introduce more specs. (`.agents` / `AGENTS.md`, while also supporting adjacent conventions like `.claude`)

## Features:

- Auto discovery of providers via ENV (Example: OPENCODE_API_KEY), or local servers (Example: ollama)
- Session management and command to create new/resume/list with local sqlite file.
- Multi-line prompt, shift enter adds a newline. Enter sends.
- Seamless shell integration with `!` in prompt input.
- Reference files and skills from the working directory and global configs with `@` in prompt input, plus autocomplete for files, skills, and agents.
- Press `ESC` at any point during an assistant response to interrupt it: the partial response is preserved in history with an interrupt stub appended (so the LLM retains context), and the user is returned to the prompt silently. `ctrl+c` exits forcefully. `ctrl+d` (EOF) gracefully exits.
- Elegantly handles hitting max context size for the model. Also handles max tool calls, gracefully finishing the turn with an update from the agent
- Feature parity with community configs like custom agents, skill and commands.
- `read`, `replace`,`insert`, `create`, `shell`, and `subagent` tools for LLMs
- read/write tools are streamlined, easy to use and rely on hashline editting pattern.
- Optional `webSearch` and `webContent` tools when `EXA_API_KEY` is set.
- `subagent` tool spawns a fresh `mc` subprocess — full capability parity with the main agent, support for recursive subagents (up to 10 levels). Custom agents and custom commands from `.agents` and `.claude` are supported in subagents.
- tool hooks support for supported built-in tools
- Commands in CLI prompt:
  - `/model` command allows the user to pick a model from connected providers. As well as thinking effort for the model if supported. Selection persists accross sessions.
  - `/undo` removes the last turn from conversation history.
  - `/reasoning` toggles display of model reasoning output.
  - `/context` configures context pruning and tool-result caps.
  - `/review` reviews recent changes via a global command installed at app start (`~/.agents/commands/review.md`), and can be customized or shadowed locally.
  - `/agent` sets or clears the active primary agent.
  - `/mcp` list/add/remove mcp servers. servers are stored in sqlite
  - `/new` starts a new session with clean context. Clean UI and fresh session display
  - `/_debug` hidden command that snapshots recent logs/db and creates a report in the cwd. For dev mostly but available to all. Do not list it anywhere, only documented here and in the code itself.
- Connect to MCP servers over Streamable HTTP / SSE fallback or stdio.
- Image support in prompt input, including pasted image data URLs and pasted image file paths.
- Excellent auto complete for all commands, subtituitions. The user should also be able to reference files with autocomplete wihtout including them into the prompt like `@` does with TAB

## UI/Output

- Use the 16 ANSII colors so the coloring is allways inherited from the terminal theme (https://jvns.ca/blog/2024/10/01/terminal-colours/)
- Use pi and claude code as visual inspirations.
- Banner at app start, show found configs and context files
- history log (like a terminal output scrolls away, pushing the input prompt down)
  - Read tool show the tool call with args fomatted for output
  - Edit tools show the diff applied
  - Shell tools show the command called and their output
- status bar like prompt, with current model/provider/session/git branch/active agent/thinking effort/context usage/token input/token output
- some prompt colored animation when a turn is processing. Needs to be carefully done, so it shows correctly in wait times and with clear labels

## Tech stack

- All things Bun.js, runtime, package manager. https://bun.com/docs
- Multiprovider support via https://ai-sdk.dev/docs/introduction
- Colored output with https://github.com/sindresorhus/yoctocolors limitted but fast!
- Markdow rendering support without sacrificing speed and performance

## Repo structure

Clean separation of concerns, use modules to organize the app.
No mocked/offline-servers type of tests

Core modules:

- `llm-api`: Provides the api to intereact with the provider and process the full conversation turn + tool calling.
- `cli`: Output/UI
- `agent`: Main agent implementation
- `tools`: local filesystem, shell, subagent, and web/search helpers
- `session`: sqlite-backed sessions, settings, model info, and MCP server storage
- `mcp`: handles connecting to mcp servers
