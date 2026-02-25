# Config conventions

mini-coder supports both its native `.agents` convention and Claude Code's `.claude` convention for commands and skills.

## Supported config roots

| Root | Purpose |
|---|---|
| `.agents/` | mini-coder native config |
| `.claude/` | Claude Code-compatible commands/skills |

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

## Agents (mini-coder specific)

Custom subagents are configured in `.agents`:

- `./.agents/agents/*.md`
- `~/.agents/agents/*.md`

(There is no `.claude` compatibility path for agents.)

## Precedence and conflicts

Precedence rules:

1. **Local overrides global**
2. At the **same scope** (both local or both global), if `.agents` and `.claude` define the same command/skill name, **`.agents` wins**

When same-scope conflicts are detected for commands/skills, mini-coder prints a warning and uses the `.agents` version.
