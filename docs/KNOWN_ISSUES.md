# KNOWN ISSUES

## Bugs

- `/model` doesn't autocomplete models provider/name pattern.
- CTRL+d hangs sometimes and doesn't exit.
- `supportsThinking()` trusts models.dev flag too broadly — sends adaptive thinking to models that reject it (e.g. `claude-haiku-4-5` via Zen returns 400).
- AI SDK expands `claude-3-5-haiku` → dated variant that Zen doesn't serve (404).
- Shell tool max-timeout leaves the parent terminal in a broken state.
- Truncated tool commands cut mid-argument (e.g. `--new '{…`). Truncate at argument boundaries instead.

## Features

- Conversation summary on max context instead of just an error with `/new` suggestion.
- Derive `maxOutputTokens` from model info instead of hardcoding 16384.

## Refactors

- Status bar: merge model + thinking effort into one field, drop `showReasoning` (already in banner).
