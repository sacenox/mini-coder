# Custom Agents

An agent is a subagent with a custom system prompt and optional model override.
Use `@agent-name` anywhere in your prompt to route the message through it.

## Where to put them

| Location | Scope |
|---|---|
| `.agents/agents/*.md` | Current repo only |
| `~/.agents/agents/*.md` | All projects (global) |

Local agents override global ones with the same name.

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
@reviewer review the auth module for race conditions
```

The rest of the message (everything except the `@reviewer` token) becomes
the prompt. The agent runs in its own context window and returns its output
into the conversation.

## Frontmatter fields

| Field | Required | Description |
|---|---|---|
| `description` | No | Shown in `/help`. Defaults to filename. |
| `model` | No | Override the active model for this agent. |

The markdown body (after frontmatter) is the agent's system prompt.

## Combining with files

`@file` references are resolved before the agent fires:

```
@reviewer @src/auth/session.ts check this file for issues
```

## Tab completion

Type `@` and press `Tab` to autocomplete agent names alongside files.

## Listing agents

```
/help
```

Agents are listed in magenta, tagged `(local)` or `(global)`.
