---
name: mini-coder
description: How to use the `mc` CLI coding agent
---

# mini-coder

Use this skill when you need to help a user operate the `mc` command-line tool.

`mc` is the executable for **mini-coder**, a small CLI coding agent. This skill is about **how to use the tool**, not how the mini-coder repo is implemented.

## What `mc` does

- Starts an interactive coding session in the terminal
- Accepts a one-shot prompt from the command line
- Persists sessions locally so they can be resumed
- Lets users switch models, manage MCP servers, and load custom agents/skills/commands

## Core command-line usage

```sh
mc
mc "explain this codebase"
mc -c
mc -r <session-id>
mc -l
mc -m <model-id>
mc --cwd <path>
mc -h
```

## Most common flows

### Start an interactive session

```sh
mc
```

Use this when the user wants a normal back-and-forth coding session.

### Run a prompt immediately

```sh
mc "refactor the auth module to use async/await"
```

Use this when the user already knows the task they want to give `mc`.

### Continue a previous session

```sh
mc -c
mc -r <session-id>
mc -l
```

- `mc -c` continues the most recent session
- `mc -r <session-id>` resumes a specific session
- `mc -l` lists recent sessions so the user can find an ID

### Pick a model

```sh
mc -m zen/claude-sonnet-4-6
mc -m ollama/llama3.2
```

Use `-m` when the user wants a specific provider or local model.

### Run in another directory

```sh
mc --cwd ~/src/other-project
```

Useful when the user is not already inside the target repo.

## Interactive slash commands

Inside `mc`, the user can run slash commands such as:

- `/help` — show help
- `/model` — list models
- `/model <id>` — switch models
- `/model effort <low|medium|high|xhigh|off>` — set reasoning effort when supported
- `/reasoning [on|off]` — toggle reasoning display
- `/undo` — remove the last conversation turn (does not revert filesystem changes)
- `/new` — start a fresh session
- `/mcp list` — list configured MCP servers
- `/mcp add <name> http <url>` — add an HTTP MCP server
- `/mcp add <name> stdio <cmd> [args...]` — add a stdio MCP server
- `/mcp remove <name>` — remove an MCP server
- `/agent [name]` — set or clear an active primary custom agent
- `/login` — show OAuth login status
- `/login <provider>` — login via OAuth (opens browser). Currently supports `anthropic`
- `/logout <provider>` — clear saved OAuth tokens
- `/exit`, `/quit`, `/q` — leave the session

## Prompt input features

### Shell input

If the user starts a prompt with `!`, `mc` runs that shell command inline and can use the result in context.

mini-coder itself is shell-first: repo inspection happens primarily through shell commands, and targeted edits are typically done via `mc-edit` invoked from shell.

### References with `@`

`mc` supports `@` references in prompts for:

- files
- custom agents
- skills

This helps users quickly pull relevant context into a prompt.

## File editing with mc-edit

`mc` is shell-first. The preferred workflow for file edits is: inspect with shell → edit with `mc-edit` → verify with shell.

`mc-edit` is a helper command invoked from the shell tool for targeted, exact-text file edits:

```sh
mc-edit <path> (--old <text> | --old-file <path>) [--new <text> | --new-file <path>] [--cwd <path>]
```

- Applies one exact-text replacement to an existing file
- The old text must match exactly once (fails on zero or multiple matches)
- Omit `--new`/`--new-file` to delete the matched text
- On success: prints a unified diff + metadata (`ok`, `path`, `changed`)
- On no-op: prints `(no changes)` + metadata
- Errors go to stderr

### Examples

Replace a function signature:

```sh
mc-edit src/auth.ts --old "function login(user)" --new "async function login(user)"
```

Delete a block:

```sh
mc-edit src/config.ts --old "// TODO: remove this
const DEBUG = true;"
```

Use temp files for large edits:

```sh
mc-edit src/big-file.ts --old-file /tmp/old.txt --new-file /tmp/new.txt
```

## Config locations

mini-coder supports both `.agents` and `.claude` config layouts.

### Local config in a repo

- `.agents/commands/*.md`
- `.agents/agents/*.md`
- `.agents/skills/<name>/SKILL.md`

### Global config in the home directory

- `~/.agents/commands/*.md`
- `~/.agents/agents/*.md`
- `~/.agents/skills/<name>/SKILL.md`

Same ideas also work under `.claude/` and `~/.claude/`.

## Data and state

mini-coder stores app data in:

```text
~/.config/mini-coder/
```

This includes session history, MCP server config, and related local metadata.

## How to help users effectively

When answering questions about `mc`:

- Prefer giving exact commands the user can paste
- Distinguish clearly between **shell commands** (run before or around `mc`) and **slash commands** (run inside `mc`)
- Suggest `mc -h` or `/help` when the user needs command discovery
- Suggest `mc -l`, `mc -c`, or `mc -r <id>` for session recovery
- Mention `--cwd` when the problem is about the wrong working directory
- Mention `-m <model-id>` when the problem is model selection
- Mention MCP commands only when the user is integrating external tools

## Examples to suggest

```sh
mc
mc "add tests for src/internal/file-edit/exact-text.ts"
mc -c
mc -l
mc -m zen/claude-sonnet-4-6
mc --cwd ~/src/my-project
```

If a user asks how to do something in mini-coder, answer in terms of the `mc` CLI and its interactive commands.