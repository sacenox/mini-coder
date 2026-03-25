# KNOWN ISSUES

## Bugs

- AI SDK expands `claude-3-5-haiku` → dated variant that Zen doesn't serve (404).
- Shell tool: model can `tmux kill-session` the host tmux session if names collide (e.g. audit skill creates session named "audit" matching the user's). Not a code bug — the skill/model just picks a conflicting name. Mitigate via skill wording or session name prefixing.
- Shell tool output truncation only stops reading stdout/stderr; it does not terminate the underlying process yet. Commands that emit a lot of output and then keep running can still block until they exit or hit timeout.

## Features

- Conversation summary on max context instead of just an error with `/new` suggestion.

## Refactors
