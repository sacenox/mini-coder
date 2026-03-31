# KNOWN ISSUES

## Bugs

- AI SDK expands `claude-3-5-haiku` → dated variant that Zen doesn't serve (404).
- Shell tool output truncation only stops reading stdout/stderr; it does not terminate the underlying process yet. Commands that emit a lot of output and then keep running can still block until they exit or hit timeout.
- Cancel watcher cleanup starts before model resolution but is only torn down later in the turn flow. If model resolution fails first, interactive terminal/input state may be left inconsistent.
- MCP runtime state is not reconciled live: removing a server only deletes its DB row, and re-adding/updating can leave stale or duplicate live MCP tools until `/new` or a session switch reconnects everything.
- Switching or resuming a session does not update the active working directory. Shell passthrough, file refs, prompt context, and status UI keep using the process startup `cwd`, so a session from another repo can run against the wrong project.
- SQLite schema version mismatches rotate the existing DB aside and start from a fresh empty DB instead of migrating or warning clearly. Upgrades can make session history, MCP config, OAuth state, and cached model info appear lost unless the user manually recovers the backup.

## Features

- Conversation summary on max context instead of just an error with `/new` suggestion.

## Refactors
