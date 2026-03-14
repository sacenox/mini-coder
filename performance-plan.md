# Performance Improvement Plan

Based on the audit in the previous session. Three high-impact fixes, three medium fixes, four low/deferred items.

---

## High Impact

### P1 — Wrap `saveMessages` in a transaction

**File:** `src/session/db/message-repo.ts`

Each `stmt.run()` without an explicit transaction triggers its own implicit WAL flush.
`saveMessages` is called twice per turn (user message + model messages), each time potentially
writing multiple rows. `saveSnapshot` already does this correctly with `db.transaction`.

**Change:** Wrap the insert loop in `db.transaction(() => { ... })`.

---

### P2 — Cache `buildSystemPrompt` on `SessionRunner`

**Files:** `src/agent/session-runner.ts`, `src/agent/system-prompt.ts`

`buildSystemPrompt` is called on every `processUserInput`. It does:
- Up to 5 `existsSync` + 2 `readFileSync` calls for context files
- `loadSkillsIndex` → directory walk (`readdirSync` + `statSync` + `openSync`/`readSync`/`closeSync`) across 4 locations

None of these inputs change between turns. The system prompt is fixed for the lifetime of
a `SessionRunner` instance (only `extraSystemPrompt` changes, and that has a setter).

**Change:**
- Compute the prompt once in the `SessionRunner` constructor and store it.
- Re-compute only when `extraSystemPrompt` is mutated (already a public setter property).
- No change to the `buildSystemPrompt` function signature.

---

### P3 — Remove intermediate diff from `applyFileEdit`

**Files:** `src/tools/shared.ts`, `src/tools/write-result.ts`, `src/agent/tools.ts`

Current flow for any write tool when hooks are active (the default config):
1. `applyFileEdit` writes the file and calls `generateDiff(original, written)` → **diff #1**
2. Hook runs (reformatter rewrites the file)
3. `finalizeWriteResult` re-reads and calls `generateDiff(original, reformatted)` → **diff #2**

Diff #1 is always discarded when a hook fires. `generateDiff` runs an LCS O(m×n) algorithm;
computing it twice wastes CPU on every write in a repo with hooks.

When no hook fires, `stripWriteResultMeta` is used, which keeps diff #1 — so that path stays correct.

**Change:**
- Remove `generateDiff` call from `applyFileEdit`; store only `_before` + `_filePath`.
- Move diff computation into `finalizeWriteResult` (already reads the post-hook file).
- For the no-hook path (`stripWriteResultMeta`), add the diff computation there too so callers still receive a populated `diff` field.
- Update `WriteResultMeta` and `applyFileEdit` return type accordingly.

---

## Medium Impact

### P4 — Gate `getMessageDiagnostics` behind API log being enabled

**File:** `src/llm-api/turn.ts`

`getMessageDiagnostics` is called 2–3× per turn. It calls `JSON.stringify` + `Buffer.byteLength`
on every message in history. For long sessions (100+ messages) this serialises megabytes of data
just to produce numbers for the API log.

**Change:**
- Check whether the API log is enabled before computing diagnostics.
- If disabled, skip all three `getMessageDiagnostics` calls entirely.
- `api-log.ts` already has the flag; expose a `isApiLogEnabled()` helper or check the env directly.

---

### P5 — Hoist `db.prepare` to a module-level lazy singleton in `saveMessages`

**File:** `src/session/db/message-repo.ts`

`db.prepare(...)` compiles the SQL statement on every `saveMessages` call (twice per turn).
SQLite statement preparation is cheap but non-trivial; it is unnecessary to repeat it.

**Change:**
- Store the prepared statement in a module-level `let` variable, initialised lazily on first use
  (same pattern as `getDb()`).
- Apply the same treatment to `addPromptHistory` and `getPromptHistory` if they are on hot paths.

---

### P6 — Avoid object spread in `withCwdDefault` per tool invocation

**File:** `src/agent/tools.ts`

`withCwdDefault` wraps every tool call in a new object spread:
```ts
const withDefault = { cwd, ...snapshotCallback ? {snapshotCallback} : {}, ...input };
```
This allocates a new plain object on every invocation and spreads all tool arguments.

**Change:**
- Mutate `cwd` as a default on the input object only when absent:
  ```ts
  const patched = input as Record<string, unknown>;
  if (patched.cwd === undefined) patched.cwd = cwd;
  if (snapshotCallback && patched.snapshotCallback === undefined)
      patched.snapshotCallback = snapshotCallback;
  return originalExecute(patched);
  ```
- This avoids the spread allocation entirely.

---

## Low / Deferred

### P7 — Replace string concatenation in `consumeTail` with chunk accumulation

**File:** `src/agent/subagent-runner.ts`

`tail += decoder.decode(...)` in a loop is O(n²) in theory, bounded to ~16 KB by the slicing
guard. Still wasteful: each iteration copies the whole accumulated string.

**Change:**
- Accumulate `Uint8Array` chunks into an array.
- After the loop, call `new TextDecoder().decode(Buffer.concat(chunks))` once.
- Then slice to `maxBytes` if needed.
- Remove the mid-loop `tail.slice(-maxBytes)` guard; it is no longer necessary.

---

### P8 — Replace LCS diff with Myers diff to reduce memory

**File:** `src/tools/diff.ts`

`lcsTable` allocates a flat `number[]` of `(m+1)*(n+1)` entries. Two 1000-line files produce ~1M
entries (~8 MB) per diff call. Every `replace`, `insert`, and `create` invocation pays this cost.

**Change:**
- Implement Myers diff (Eugene Myers, 1986) in place of `lcsTable` / `editScript`.
- Myers requires only O(n·d) space where d is the number of edits — typically a small fraction of
  file size.
- The public API (`generateDiff`) and unified-diff output format are unchanged; only the internal
  `lcsTable` + `editScript` functions are replaced.

---

### P9 — Combine sequential message-history transforms in `runTurn`

**File:** `src/llm-api/turn.ts`

Five separate O(n) passes over the full message history per turn:
`sanitizeGemini` → `stripGPTCommentary` → `stripOpenAIItemIds` → `applyContextPruning` →
`compactToolResultPayloads`. Each allocates a new array even when returning the same messages
unchanged.

**Change:**
- Merge `stripGPTCommentary` and `stripOpenAIItemIds` into a single pass: both are
  OpenAI-only, both iterate messages looking for assistant content parts to filter. They can share
  one `messages.map(...)` call with both predicates applied per message.
- `sanitizeGemini`, `applyContextPruning`, and `compactToolResultPayloads` operate on different
  structural concerns and keep their fast-path early exits; leave them as separate named functions
  but note the combined pass reduces allocations on OpenAI sessions by one full array copy.

---

### P10 — Move `VACUUM` off the synchronous startup path

**File:** `src/session/db/connection.ts`

`pruneOldData` calls `db.exec("VACUUM;")` synchronously before the CLI prompt is shown. With a
large or fragmented DB this can add measurable latency to startup.

**Change:**
- Replace the synchronous `VACUUM` call with `setImmediate(() => db.exec("VACUUM;"))` so it runs
  after the event loop yields control back to the CLI render path.
- The WAL checkpoint (`wal_checkpoint(TRUNCATE)`) is fast and can remain synchronous.

---

## Execution Order

```
P1  saveMessages transaction          — 5 min,  isolated, zero risk
P5  hoist db.prepare                  — 10 min, isolated, zero risk
P10 defer VACUUM off startup path     — 10 min, isolated, zero risk
P7  consumeTail chunk accumulation    — 15 min, isolated
P3  remove intermediate diff          — 30 min, touches shared.ts + write-result.ts + tools.ts
P8  Myers diff                        — 60 min, self-contained in diff.ts, existing tests cover it
P2  cache system prompt               — 45 min, touches session-runner.ts
P6  withCwdDefault spread             — 20 min, touches tools.ts
P4  gate diagnostics on log flag      — 20 min, touches turn.ts
P9  merge OpenAI message transforms   — 30 min, touches turn.ts
```
