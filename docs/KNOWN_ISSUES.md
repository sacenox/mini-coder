# KNOWN ISSUES

## Bugs

- AI SDK expands `claude-3-5-haiku` → dated variant that Zen doesn't serve (404).
- Shell tool: model can `tmux kill-session` the host tmux session if names collide (e.g. audit skill creates session named "audit" matching the user's). Not a code bug — the skill/model just picks a conflicting name. Mitigate via skill wording or session name prefixing.

## Features

- Conversation summary on max context instead of just an error with `/new` suggestion.

## Refactors
