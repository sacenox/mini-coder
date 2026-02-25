# Skills

A skill is a reusable instruction file injected inline into your prompt.
Use `@skill-name` to load it — the content is inserted into the message
before it's sent to the LLM.

> **Skills are never auto-loaded.** They must be explicitly referenced
> with `@skill-name` in your prompt. Nothing is injected automatically.

## Where to put them

Each skill is a folder containing a `SKILL.md`:

| Location | Scope |
|---|---|
| `.agents/skills/<name>/SKILL.md` | Current repo only |
| `~/.agents/skills/<name>/SKILL.md` | All projects (global) |

Local skills override global ones with the same name.

## Create a skill

The folder name becomes the skill name (unless overridden by `name:` in frontmatter).

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
included in the message sent to the LLM.

## Frontmatter fields

| Field | Required | Description |
|---|---|---|
| `name` | No | Skill name for `@` reference. Defaults to folder name. |
| `description` | No | Shown in `/help`. Defaults to name. |

## Tab completion

Type `@` and press `Tab` to autocomplete skill names alongside files.

## Listing skills

```
/help
```

Skills are listed in yellow, tagged `(local)` or `(global)`.
