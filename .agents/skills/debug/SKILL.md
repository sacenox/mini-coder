---
name: debug
description: Debug mini-coder issues by analyzing session logs and database entries. Access error logs, API call logs, and session history from the database.
---

# debug

Use this skill when the user needs to debug mini-coder issues, investigate errors, or audit API logs and session history.

The `/debug` command provides access to:

- **Error logs** – exceptions and runtime errors from a session
- **API logs** – LLM API calls, model routing, context pruning, and provider events
- **Session data** – message history, model settings, and session metadata

## Commands

```
/debug [session-id]          Show debug info for current or specified session
/debug errors [session-id]   Show only error logs for a session
/debug api [session-id]      Show only API logs for a session
/debug sessions              List all sessions with metadata
```

## Example usage

```
/debug                       # Show current session logs and metadata
/debug abc123               # Show logs for session abc123
/debug errors               # Show only errors from current session
/debug api dev-session      # Show API calls from dev-session
/debug sessions             # List all sessions
```

## What you'll see

**Error logs** include:

- Caught exceptions with context
- API errors and retries
- Validation failures
- Uncaught exceptions

**API logs** include:

- Provider requests and responses
- Token usage and model routing
- Context pruning statistics
- Tool call handling
- Prompt caching events

**Session metadata** shows:

- Session ID, creation time, working directory
- Model and settings used
- Message count and turn history
- Last update time

## Integration with mini-coder

The logging system stores all errors and API events in the SQLite database (`~/.config/mini-coder/sessions.db`) in the `logs` table, keyed by session ID. This allows persistent debugging and audit trails across multiple sessions.
