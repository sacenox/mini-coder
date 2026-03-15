# Config conventions

mini-coder supports both its native `.agents` convention and `.claude` layouts for commands, skills, and agents.

Only commands, skills, agents, and context files are loaded from these roots. Hook directories are ignored.

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

- `./.agents/skills/<skill-name>/SKILL.md`
- `~/.agents/skills/<skill-name>/SKILL.md`
- `./.claude/skills/<skill-name>/SKILL.md`
- `~/.claude/skills/<skill-name>/SKILL.md`

Format:

```md
---
name: optional-skill-name
description: Optional help text
---

Skill instructions/content.
```

If `name` is omitted, folder name is used.

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

When same-scope conflicts are detected for commands, skills, or agents, mini-coder prints a warning and uses the `.agents` version.