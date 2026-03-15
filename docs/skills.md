# Skills

Skills are reusable instruction files discovered automatically from local and global directories.

When a skill tells mini-coder how to work with files, prefer shell for inspection/search/verification and `mc-edit` from shell for targeted edits.

- The model sees **skill metadata only** by default (name, description, source).
- Full `SKILL.md` content is loaded **on demand**:
	- when explicitly requested with the runtime skill tools (`listSkills` / `readSkill`), or
	- when you reference `@skill-name` in your prompt.

## Discovery locations

Skills live in folders containing `SKILL.md`:

| Location | Scope |
|---|---|
| `.agents/skills/<name>/SKILL.md` | Local |
| `.claude/skills/<name>/SKILL.md` | Local (Claude-compatible) |
| `~/.agents/skills/<name>/SKILL.md` | Global |
| `~/.claude/skills/<name>/SKILL.md` | Global (Claude-compatible) |

Local discovery walks up from the current working directory to the git worktree root.

## Precedence rules

If multiple skills share the same `name`, precedence is deterministic:

1. Nearest local directory wins over farther ancestor directories.
2. Any local skill wins over global.
3. At the same scope/path level, `.agents` wins over `.claude`.

## Frontmatter

`SKILL.md` frontmatter supports:

- `name` (**required**)
- `description` (**required**)

`name` constraints:

- lowercase alphanumeric and hyphen format (`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
- 1–64 characters

Unknown frontmatter fields are allowed.

If either `name` or `description` is missing, mini-coder skips the skill and prints a warning.


## Create a skill

`.agents/skills/conventional-commits/SKILL.md`:

```md
---
name: conventional-commits
description: Conventional commit message format rules
---

# Conventional Commits

Use:
<type>(<scope>): <short summary>
```

## Use a skill explicitly

```text
@conventional-commits write a commit message for my staged changes
```

`@skill-name` injects the raw skill body wrapped as:

```xml
<skill name="conventional-commits">
...
</skill>
```

## Tab completion and help

- Type `@` then `Tab` to complete skill names.
- Run `/help` to list discovered skills with `(local)` / `(global)` tags.