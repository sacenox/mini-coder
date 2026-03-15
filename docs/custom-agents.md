# Custom Agents

A custom agent is a reusable system prompt with an optional model override.
You can activate one with `/agent <name>`, and non-`primary` agents are also exposed to the `subagent` tool.

mini-coder is shell-first, so custom agents should assume repo inspection and verification happen through shell, with targeted edits done via `mc-edit` invoked from shell.

## Where to put them

| Location | Scope |
|---|---|
| `.agents/agents/*.md` | Current repo only |
| `~/.agents/agents/*.md` | All projects (global) |
| `.claude/agents/*.md` | Current repo only (`.claude` layout) |
| `~/.claude/agents/*.md` | All projects (global, `.claude` layout) |

Local agents override global ones with the same name. At the same scope, `.agents` wins over `.claude`.

## Create an agent

The filename becomes the agent name.

`~/.agents/agents/reviewer.md`:

```md
---
description: Strict code reviewer focused on bugs and structure
model: zen/claude-sonnet-4-6
---

You are a senior engineer doing a code review. Be direct and specific.
Cite file and line number for every finding. Flag bugs first, then
structure issues, then style — only if they violate project conventions.
No flattery. End with a one-line verdict.
```

Then in the REPL:

```
/agent reviewer
review the auth module for race conditions
```

## Frontmatter fields

| Field | Required | Description |
|---|---|---|
| `description` | No | Shown in `/help`. Defaults to filename. |
| `model` | No | Override the active model for this agent. |
| `mode` | No | Controls whether the agent is exposed through the `subagent` tool. `primary` excludes it from that tool and is intended for `/agent`. `subagent`, `all`, and an omitted value all keep it available to the `subagent` tool. Any loaded agent can currently still be selected with `/agent <name>`. |

The markdown body (after frontmatter) is the agent's system prompt.

## Combining with files

File references are resolved before the prompt is sent:

```
/agent reviewer
@src/auth/session.ts check this file for issues
```

## Listing agents

```
/help
```

Agents are listed in magenta, tagged `(local)` or `(global)`.