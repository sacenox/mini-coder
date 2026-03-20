# KNOWN ISSUES

## Bugs

- CTRL+d hangs sometimes and doesn't exit.
- `supportsThinking()` trusts models.dev flag too broadly — sends adaptive thinking to models that reject it (e.g. `claude-haiku-4-5` via Zen returns 400).
- AI SDK expands `claude-3-5-haiku` → dated variant that Zen doesn't serve (404).
- Shell tool max-timeout leaves the parent terminal in a broken state.
- MiniMax sends empty text deltas in one-shot — renders as blank lines.
- Double prompt glyph after ESC — `turn-complete` newline + input loop prompt collide.
- Truncated tool commands cut mid-argument (e.g. `--new '{…`). Truncate at argument boundaries instead.

## Features

- Conversation summary on max context instead of just an error with `/new` suggestion.
- Derive `maxOutputTokens` from model info instead of hardcoding 16384.
- `/_debug` hidden command — snapshot recent logs/db into a report in cwd.

## Refactors

- Consolidate truncation helpers across cli modules into `cli/truncate.ts`.
- Consolidate `parseSkillFrontmatter` (skills.ts) with `parseFrontmatter` (frontmatter.ts).
- Status bar: merge model + thinking effort into one field, drop `showReasoning` (already in banner).
