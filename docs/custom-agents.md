# Custom Agents and Skills

Two ways to extend mini-coder with reusable AI behaviour via `@` references.

---

## Agents

An agent is a subagent with a custom system prompt and optional model override.
Use `@agent-name` anywhere in your prompt to route the message through it.

### Where to put them

| Location | Scope |
|---|---|
| `.agents/agents/*.md` | Current repo only |
| `~/.agents/agents/*.md` | All projects (global) |

Local agents override global ones with the same name.

### Create an agent

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

### Combining with skills

Skills and files are resolved before the agent fires, so you can mix them:

```
@reviewer @src/auth/session.ts check this file for issues
```

The file content is injected into the prompt, then the whole thing is sent
to the reviewer agent.

### Frontmatter fields

| Field | Required | Description |
|---|---|---|
| `description` | No | Shown in `/help`. Defaults to filename. |
| `model` | No | Override the active model for this agent. |

The markdown body (after frontmatter) is the agent's system prompt.

---

## Skills

A skill is a reusable instruction file injected inline into your prompt.
Use `@skill-name` to load it — the LLM sees the skill content as context
before your message.

### Where to put them

Each skill is a folder containing a `SKILL.md`:

| Location | Scope |
|---|---|
| `.agents/skills/<name>/SKILL.md` | Current repo only |
| `~/.agents/skills/<name>/SKILL.md` | All projects (global) |

Local skills override global ones with the same name.

### Create a skill

`.agents/skills/conventional-commits/SKILL.md`:

```md
---
name: conventional-commits
description: Conventional commit message format rules
---

# Conventional Commits

All commit messages must follow this format:

  <type>(<scope>): <short summary>

Types: feat, fix, docs, refactor, test, chore
- Summary is lowercase, no period at the end
- Breaking changes: add `!` after type, e.g. `feat!:`
- Body is optional, wrapped at 72 chars
```

Then in the REPL:

```
@conventional-commits write a commit message for my staged changes
```

The skill content is wrapped in `<skill name="…">…</skill>` tags and
prepended to your message before it's sent to the LLM.

### Frontmatter fields

| Field | Required | Description |
|---|---|---|
| `name` | No | Skill name for `@` reference. Defaults to folder name. |
| `description` | No | Shown in `/help`. Defaults to name. |

---

## Tab completion

Type `@` and press `Tab` to autocomplete. Skills and agents are listed
first, then local files — up to 10 results total.

## Listing available agents and skills

```
/help
```

Agents are shown in magenta, skills in yellow, tagged `(local)` or `(global)`.
