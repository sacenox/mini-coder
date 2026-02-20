# mini-coder

A coding agent via a augmented CLI, small and fast that doesn't get in the way

## Inpirations:

- Oh my pi: https://github.com/can1357/oh-my-pi amazing tool, like a swiss army knife of coding agents.
- Claude Code: https://claude.com/product/claude-code clean UI, propertary software
- Codex: https://github.com/openai/codex Powerful and open source, focused on heavy open-ai integration
- Opencode: https://opencode.ai/ The open source standard. Similar to oh-my-pi but with a different aesthetic

## Philosophy:

Very focused on dev flow, simple setup steps and fast to coding.
Elegant output that focus on the conversation with the agent and their actions.
Accurate and reliable core set of features.
Fast and performant
Community oriented, all of the inspirations have their own dotfile format, try to follow the existing
conventions and not introduce more specs. (skills.sh installs to `.agents,AGENTS.md` which could be a good one for us)

## Features:

- Auto discovery of providers via ENV (Example: OPENCODE_API_KEY), or local servers (Example: ollama)
- Session management and command to create new/resume/list with local sqlite file.
- Seamless shell integration with aliases and completions with `!` in prompt input.
- Reference files, skills, agents from the working directory and global configs with `@` in prompt input
- Cancel LLM request and undo last LLM turn
- `glob`, `grep`, `read`, `edit`, `shell`, and `subagent` tools for LLMs
- tool hooks support (do command automatically after certain tools)
- Commands in CLI prompt:
  - `/model` command allows the user to pick a model from connected providers. As well as thinking effort for the model if supported. Selection persists accross sessions.
  - `/review` command sends a subagent with a specific prompt to review code well
  - `/mcp` list/add/remove mcp servers. servers are stored in sqlite
  - `/plan` for a read-only mode (`/plan` again to turn off)
- Connect to streaming MCPs (Example: https://exa.ai/docs/reference/exa-mcp)

## UI/Output

- Use the 16 ANSII colors so the coloring is allways inherited from the terminal theme (https://jvns.ca/blog/2024/10/01/terminal-colours/)
- Use oh-my-pi and claude code as visual inspirations.
- history log (like a terminal output scrolls away, pushing the input prompt down)
  - Read tools (glob, grep, read) show the tool call with args fomatted for output
  - Edit tools show the diff applied
  - Shell tools show the command called and their output
- status bar under prompt, with current model/provider/cwd/git branch/unique context size/token ouput/token input
- some prompt animation when a turn is processing.

## Tech stack

- All things Bun.js, runtime, package manager. https://bun.com/docs
- Multiprovider support via https://ai-sdk.dev/docs/introduction
- Colored output with https://github.com/sindresorhus/yoctocolors limitted but fast!

## Repo structure

Clean separation of concerns, use modules to organize the app.
No mocked/offline-servers type of tests

Core modules:

- `llm-api`: Provides the api to intereact with the provider and process the full conversation turn + tool calling.
- `cli`: Output/UI
- `agent`: Main agent implementation
- `tools/subagent`: subagent tool implementation
- `tools/read-write-shell`: all of the tools that use the local filesystem/shell
- `mcp`: handles connecting to mcp servers
