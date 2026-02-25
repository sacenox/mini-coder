# Custom Commands

Custom commands let you define reusable prompts that run as `/command` in the mini-coder REPL.

## Where to put them

| Location | Scope |
|---|---|
| `.agents/commands/*.md` | Current repo only |
| `~/.agents/commands/*.md` | All projects (global) |

Local commands override global ones with the same name.

## Create a command

Create a markdown file. The filename becomes the command name.

`.agents/commands/standup.md`:

```md
---
description: Summarise what changed since yesterday
model: zen/claude-3-5-haiku
---

Run `!`git log --oneline --since=yesterday`` and summarise the changes
as a short standup update. Group by theme, skip merge commits.
```

Then in the REPL:

```
/standup
```

## Frontmatter fields

| Field | Required | Description |
|---|---|---|
| `description` | No | Shown in `/help`. Defaults to the command name. |
| `model` | No | Override the active model for this command. |

## Arguments

Use `$ARGUMENTS` for the full argument string, or `$1`, `$2`, … `$9` for individual tokens.

`.agents/commands/search.md`:

```md
---
description: Search the codebase for a topic
model: zen/claude-3-5-haiku
---

Search the codebase for: $ARGUMENTS

Use glob, grep, and read tools to explore thoroughly. Report all
relevant files, key code snippets with line numbers, and a short summary.
Be exhaustive but concise. No edits — read only.
```

```
/search session management
/search error handling in providers
```

Positional tokens:

```md
---
description: Create a new component
---

Create a React component named $1 in the $2 directory.
Use TypeScript, include prop types and a default export.
```

```
/component Button src/ui
```

## Shell interpolation

Use `` !`cmd` `` to inject shell output into the prompt at expansion time.
Commands time out after 10 seconds.

```md
---
description: Review failing tests
---

The following tests are currently failing:

!`bun test 2>&1 | grep "fail\|✗" | head -20`

Investigate the failures and suggest fixes. Read the relevant source
files before drawing conclusions.
```

```
/fix-tests
```

## Model override

Specify a model in frontmatter to use a faster or cheaper model for
lightweight tasks regardless of what the session is currently set to.

```md
---
description: Quick grep for a symbol
model: zen/claude-3-5-haiku
---

Find all usages of $ARGUMENTS across the codebase using grep and glob.
List each occurrence with file path and line number. No explanations needed.
```

Large models for deep analysis, small models for search and lookup.

## Precedence

Custom commands shadow built-ins. If you create `.agents/commands/review.md`
it will replace the built-in `/review` for that project.

## Listing commands

```
/help
```

Custom commands are listed at the bottom under **custom commands**, tagged
with `(local)` or `(global)`.
