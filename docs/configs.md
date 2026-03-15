# Config conventions

mini-coder supports both its native `.agents` convention and `.claude` layouts for commands, skills, and agents.

Only commands, skills, agents, and context files are loaded from these roots. Hook directories are ignored.

Discovery is not identical for every config type:

- **Commands** and **agents** are loaded from the current working directory and the home directory only.
- **Skills** are loaded from the home directory plus local directories discovered by walking up from the current working directory to the git worktree root.
- **Context files** are only loaded from the current working directory and the home directory.

## Supported config roots

| Root | Purpose |
|---|---|
| `.agents/` | mini-coder native config |
| `.claude/` | Alternate config layout supported by mini-coder |

Each root can exist in:

- **Local (repo):** `./.agents`, `./.claude`
- **Global (home):** `~/.agents`, `~/.claude`

## Commands

Supported locations:

- `./.agents/commands/*.md`
- `~/.agents/commands/*.md`
- `./.claude/commands/*.md`
- `~/.claude/commands/*.md`

Format:

```md
---
description: Optional help text
model: optional/model-override
---

Prompt template body with $ARGUMENTS and $1..$9 support.
```

Filename becomes the command name (`review.md` => `/review`).

## Skills

Supported locations:

- local: `./.agents/skills/<skill-name>/SKILL.md` and `./.claude/skills/<skill-name>/SKILL.md`
- global: `~/.agents/skills/<skill-name>/SKILL.md` and `~/.claude/skills/<skill-name>/SKILL.md`

For local skills, mini-coder searches not just the current working directory, but each ancestor directory up to the git worktree root.

Format:

```md
---
name: required-skill-name
description: Required help text
---

Skill instructions/content.
```

Both `name` and `description` are required. Invalid skills are skipped with a warning.

## Agents

Supported locations:

- `./.agents/agents/*.md`
- `~/.agents/agents/*.md`
- `./.claude/agents/*.md`
- `~/.claude/agents/*.md`

Format:

```md
---
description: Optional help text
model: optional/model-override
mode: optional agent mode
---

Agent system prompt.
```

## Context files

mini-coder loads at most one global context file and at most one local context file, then includes both when present.

Global lookup order:

1. `~/.agents/AGENTS.md`
2. `~/.agents/CLAUDE.md`

Local lookup order:

1. `./.agents/AGENTS.md`
2. `./CLAUDE.md`
3. `./AGENTS.md`

Injection order:

1. Global context (if found)
2. Local context (if found)

## Precedence and conflicts

Precedence rules for commands, skills, and agents:

1. **Local overrides global**
2. At the **same scope** (both local or both global), if `.agents` and `.claude` define the same name, **`.agents` wins**
3. For **skills only**, when the same skill name exists in multiple local ancestor directories, the skill nearest to the current working directory wins

When same-scope `.agents` / `.claude` conflicts are detected for commands, skills, or agents, mini-coder prints a warning and uses the `.agents` version.