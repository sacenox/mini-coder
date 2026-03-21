---
name: debug
description: Debug mini-coder issues by analyzing session logs and database entries. Access error logs, API call logs, and session history from the database.
allowed-tools: shell
---

# debug

Use this skill when the user needs to debug mini-coder issues, investigate errors, or audit API logs and session history.

## Database location

```
~/.config/mini-coder/sessions.db
```

SQLite database with a `logs` table keyed by `session_id`.

## Schema

```sql
CREATE TABLE logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  level       TEXT NOT NULL,   -- "api" | "error"
  timestamp   INTEGER NOT NULL, -- Unix ms
  data        TEXT NOT NULL    -- JSON: { event: string, data: object }
)
```

## Log levels

| Level   | When written                                       |
| ------- | -------------------------------------------------- |
| `api`   | Every LLM turn lifecycle event (see events below)  |
| `error` | Caught exceptions, API failures, validation errors |

## API event reference (post-v0.x)

These are the events logged after the noise-reduction pass. Expect ~10 rows per turn:

| Event                        | Key fields in `data`                                         | Purpose                           |
| ---------------------------- | ------------------------------------------------------------ | --------------------------------- |
| `turn start`                 | `modelString`, `messageCount`, `reasoningSummaryRequested`   | Start of a user→LLM turn          |
| `turn complete`              | `newMessagesCount`, `inputTokens`, `outputTokens`            | End of turn with token usage      |
| `turn error`                 | error fields (sanitized)                                     | Turn failed                       |
| `turn context pre-prune`     | `messageCount`, `totalBytes`, `roleBreakdown`, `toolResults` | Context snapshot before pruning   |
| `turn context post-prune`    | same shape as pre-prune                                      | Context snapshot after pruning    |
| `step finish`                | `usage`, `finishReason`, `isContinued`                       | Each reasoning step within a turn |
| `stream chunk` (tool-call)   | `type:"tool-call"`, `toolCallId`, `toolName`, `isError`      | A tool was invoked                |
| `stream chunk` (tool-result) | `type:"tool-result"`, `toolCallId`, `toolName`, `isError`    | Tool result received              |

> Note: Older sessions in the DB may also contain `Provider Request`, `prompt caching configured`, and high-volume `stream chunk` events (`tool-input-delta`, `start-step`, etc.) — these were removed in a logging cleanup. The queries below filter for the current event set.

## Useful shell queries

**Recent sessions:**

```bash
bun -e "
import { getDb } from './src/session/db/connection.ts';
const db = getDb();
db.prepare('SELECT id, created_at, updated_at FROM sessions ORDER BY updated_at DESC LIMIT 10').all().forEach(r => console.log(r));
"
```

**Log counts per level for a session:**

```bash
SESSION_ID=<id>
bun -e "
import { getDb } from './src/session/db/connection.ts';
const db = getDb();
const rows = db.prepare('SELECT level, COUNT(*) as n FROM logs WHERE session_id = ? GROUP BY level').all('$SESSION_ID');
console.log(rows);
"
```

**All API events for current session (chronological):**

```bash
bun -e "
import { getDb } from './src/session/db/connection.ts';
const db = getDb();
const rows = db.prepare('SELECT timestamp, data FROM logs WHERE session_id = ? AND level = ? ORDER BY timestamp ASC').all('<session-id>', 'api');
for (const r of rows) {
  const d = JSON.parse(r.data);
  console.log(new Date(r.timestamp).toISOString(), d.event, JSON.stringify(d.data));
}
"
```

**Error logs only:**

```bash
bun -e "
import { getDb } from './src/session/db/connection.ts';
const db = getDb();
const rows = db.prepare('SELECT timestamp, data FROM logs WHERE session_id = ? AND level = ? ORDER BY timestamp ASC').all('<session-id>', 'error');
rows.forEach(r => console.log(new Date(r.timestamp).toISOString(), JSON.parse(r.data)));
"
```

**Token usage across turns (current session):**

```bash
bun -e "
import { getDb } from './src/session/db/connection.ts';
const db = getDb();
const rows = db.prepare(\"SELECT data FROM logs WHERE session_id = ? AND level = 'api' ORDER BY timestamp ASC\").all('<session-id>');
for (const r of rows) {
  const d = JSON.parse(r.data);
  if (d.event === 'turn complete') console.log(d.data);
}
"
```

**Context pressure (pre vs post prune):**

```bash
bun -e "
import { getDb } from './src/session/db/connection.ts';
const db = getDb();
const rows = db.prepare(\"SELECT timestamp, data FROM logs WHERE session_id = ? AND level = 'api' AND data LIKE '%prune%' ORDER BY timestamp ASC\").all('<session-id>');
rows.forEach(r => console.log(new Date(r.timestamp).toISOString(), JSON.parse(r.data)));
"
```

**Tool calls in a session:**

```bash
bun -e "
import { getDb } from './src/session/db/connection.ts';
const db = getDb();
const rows = db.prepare(\"SELECT timestamp, data FROM logs WHERE session_id = ? AND level = 'api' AND data LIKE '%tool-call%' ORDER BY timestamp ASC\").all('<session-id>');
rows.forEach(r => { const d = JSON.parse(r.data); console.log(new Date(r.timestamp).toISOString(), d.data.toolName); });
"
```

## Finding the current session ID

The session ID is stored in the `settings` table or you can get the most recently active session:

```bash
bun -e "
import { getDb } from './src/session/db/connection.ts';
const db = getDb();
const s = db.prepare('SELECT id FROM sessions ORDER BY updated_at DESC LIMIT 1').get();
console.log(s?.id);
"
```

## Integration with mini-coder code

- **`src/logging/context.ts`** — `logApiEvent(event, data)` and `logError(err, context)` write to the DB
- **`src/session/db/logs-repo.ts`** — `LogsRepo` class: `write()`, `getLogs()`, `deleteOldLogs()`, `deleteSessionLogs()`
- **`src/session/db/connection.ts`** — `getDb()` returns the singleton Bun SQLite instance
- Data is sanitized before write: strips `requestBodyValues`, `responseBody`, `responseHeaders`, `stack`
