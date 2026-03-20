---
name: mini-coder
description: How to use the `mc` CLI coding agent — interactive sessions, one-shot prompts, slash commands, file editing with mc-edit, and orchestrating subagents for complex tasks.
---

# mini-coder

Use this skill when you need to help a user operate the `mc` command-line tool, or when you are acting as an `mc` agent yourself.

`mc` is the executable for **mini-coder**, a small CLI coding agent. This skill covers **how to use the tool**, not how the mini-coder repo is implemented.

## Command-line usage

```sh
mc                              # interactive session
mc "explain this codebase"      # one-shot prompt
mc -c                           # continue most recent session
mc -r <session-id>              # resume a specific session
mc -l                           # list recent sessions
mc -m <model-id>                # pick a model
mc --cwd <path>                 # run in another directory
mc -h                           # help
```

## Interactive slash commands

Inside `mc`:

| Command                                         | Purpose                                       |
| ----------------------------------------------- | --------------------------------------------- |
| `/help`                                         | Show help                                     |
| `/model`                                        | List models                                   |
| `/model <id>`                                   | Switch model                                  |
| `/model effort <low\|medium\|high\|xhigh\|off>` | Set reasoning effort                          |
| `/reasoning [on\|off]`                          | Toggle reasoning display                      |
| `/verbose`                                      | Toggle output truncation                      |
| `/undo`                                         | Remove last turn (does not revert filesystem) |
| `/new`                                          | Start a fresh session                         |
| `/review`                                       | Review recent changes                         |
| `/mcp list`                                     | List MCP servers                              |
| `/mcp add <name> http <url>`                    | Add HTTP MCP server                           |
| `/mcp add <name> stdio <cmd> [args...]`         | Add stdio MCP server                          |
| `/mcp remove <name>`                            | Remove MCP server                             |
| `/agent [name]`                                 | Set or clear active custom agent              |
| `/login [provider]`                             | Show or start OAuth login                     |
| `/logout <provider>`                            | Clear OAuth tokens                            |
| `/exit`, `/quit`, `/q`                          | Leave the session                             |

## Prompt input features

- **Shell input** — prefix with `!` to run a shell command inline and feed output to the LLM.
- **File references** — `@path/to/file` embeds a file into the prompt (autocompletes paths).
- **Skill / agent refs** — `/` triggers autocomplete for skills and agents.
- **Images** — paste image data URLs or file paths directly.
- **ESC** interrupts an in-progress response (preserves partial output). `Ctrl+C` exits forcefully, `Ctrl+D` exits gracefully.

## File editing with mc-edit

`mc` is shell-first. The preferred workflow is: **inspect → edit → verify**.

```sh
mc-edit <path> (--old <text> | --old-file <path>) [--new <text> | --new-file <path>] [--cwd <path>]
```

- Applies one exact-text replacement per invocation.
- Old text must match exactly once (fails on zero or multiple matches).
- Omit `--new` / `--new-file` to delete matched text.
- Prints a unified diff + metadata on success; errors go to stderr.

### Examples

```sh
mc-edit src/auth.ts --old "function login(user)" --new "async function login(user)"

mc-edit src/config.ts --old "// TODO: remove this
const DEBUG = true;"

mc-edit src/big.ts --old-file /tmp/old.txt --new-file /tmp/new.txt
```

## Config locations

mini-coder discovers configs from both `.agents` and `.claude` layouts:

| Scope  | Paths                                                                                  |
| ------ | -------------------------------------------------------------------------------------- |
| Local  | `.agents/commands/*.md`, `.agents/agents/*.md`, `.agents/skills/<name>/SKILL.md`       |
| Global | `~/.agents/commands/*.md`, `~/.agents/agents/*.md`, `~/.agents/skills/<name>/SKILL.md` |

Same structure applies under `.claude/` and `~/.claude/`.

App data (sessions, MCP config, logs) lives in `~/.config/mini-coder/`.

## Orchestration mode

For complex, multi-part tasks you can use `mc` as a subagent coordinator.

### Core principles

- **Decompose first.** Break the task into 2–5 independent, self-contained subtasks.
- **Delegate aggressively.** Spawn focused subagents via `mc "prompt"` in the shell tool — each gets a single precise goal.
- **Parallelise when possible.** Dispatch independent subtasks concurrently.
- **Stay the coordinator.** You own the big picture; subagents handle the details. Synthesise their results, resolve conflicts, report back clearly.
- **Fail fast.** If a subagent fails, stop and reassess before continuing.

### Subagent prompt hygiene

- Be explicit about what the agent should produce (a file, a code change, a summary).
- Include all relevant paths, constraints, and acceptance criteria — subagents have no shared memory.
- Never give vague briefs; ambiguity leads to rework and wasted tokens.

### When NOT to delegate

- Trivial lookups or single-file reads — do them directly.
- Tasks requiring continuous back-and-forth with the user — handle interactively.

## Tips for helping users

- Prefer exact commands the user can paste.
- Distinguish **shell commands** (outside `mc`) from **slash commands** (inside `mc`).
- Suggest `mc -h` or `/help` for discovery.
- Suggest `mc -l` / `mc -c` / `mc -r <id>` for session recovery.
- Mention `--cwd` for wrong-directory issues, `-m` for model selection.
