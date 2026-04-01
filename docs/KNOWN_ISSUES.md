# KNOWN ISSUES

## Bugs

- AI SDK expands `claude-3-5-haiku` → dated variant that Zen doesn't serve (404).
- Shell tool output truncation only stops reading stdout/stderr; it does not terminate the underlying process yet. Commands that emit a lot of output and then keep running can still block until they exit or hit timeout.
- Cancel watcher cleanup starts before model resolution but is only torn down later in the turn flow. If model resolution fails first, interactive terminal/input state may be left inconsistent.
- MCP runtime state is not reconciled live: removing a server only deletes its DB row, and re-adding/updating can leave stale or duplicate live MCP tools until `/new` or a session switch reconnects everything.
- Switching or resuming a session does not update the active working directory. Shell passthrough, file refs, prompt context, and status UI keep using the process startup `cwd`, so a session from another repo can run against the wrong project.
- SQLite schema version mismatches rotate the existing DB aside and start from a fresh empty DB instead of migrating or warning clearly. Upgrades can make session history, MCP config, OAuth state, and cached model info appear lost unless the user manually recovers the backup.
- Persist `/model` changes to the session row immediately so resume/switch sees the new model even before another turn completes.
- Stop trimming submitted prompt text in interactive and piped flows; preserve leading indentation and trailing newlines while keeping blank-input detection.
- Rebuild/reset activated skill state on `/undo` and resume so `readSkill` matches actual remaining session history.
- Align OpenAI OAuth callback binding and redirect host so `localhost`/IPv6 resolution cannot miss the local callback server.
- Fix Windows browser launch for `/login` by using a real cross-platform opener or `cmd /c start`.
- Parse `/mcp add ... stdio ...` arguments with shell-style quoting so paths and args with spaces work.

## Features

- Conversation summary on max context instead of just an error with `/new` suggestion.

## Refactors
