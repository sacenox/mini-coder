# Plan: Lean and Mean

## Overview

Three changes:
1. **One-shot exit** — when `mc` is called with a prompt (interactive, non-subagent), exit after the agent finishes instead of dropping into the input loop.
2. **Drop `glob` and `grep` tools** — agents can use `shell` for these. Remove all related source, tests, hooks, and documentation.
3. **Cleanup pass** — dead code, orphaned helpers, stale references.

---

## 1. One-shot exit (`src/index.ts`)

Currently when a prompt is provided, `processUserInput` runs and then `runInputLoop` starts anyway. Change this:

```
if (args.prompt) {
  await runner.processUserInput(...);
  return;          // ← exit instead of falling into runInputLoop
}
await runInputLoop(...);
```

Update the `printHelp` example comment in `src/cli/args.ts` from  
`# one-shot prompt then interactive` → `# one-shot prompt then exit`.

---

## 2. Drop `glob` and `grep` tools

### Files to delete
- `src/tools/glob.ts`
- `src/tools/glob.test.ts`
- `src/tools/grep.ts`
- `src/tools/grep.test.ts`
- `src/tools/ignore.ts` — only consumed by glob and grep
- `src/tools/scan-path.ts` — only consumed by glob and grep

### `src/agent/tools.ts`
- Remove imports: `GlobOutput`, `globTool`, `GrepOutput`, `grepTool`, `hookEnvForGlob`, `hookEnvForGrep`
- Remove `"glob"` and `"grep"` from `HOOKABLE_TOOLS`
- Remove `withHooks(withCwdDefault(globTool …))` entry from `buildToolSet`
- Remove `withHooks(withCwdDefault(grepTool …))` entry from `buildToolSet`
- Remove `withCwdDefault(globTool …)` and `withCwdDefault(grepTool …)` from `buildReadOnlyToolSet`

### `src/tools/hooks.ts`
- Delete `hookEnvForGlob` function
- Delete `hookEnvForGrep` function

### `src/agent/system-prompt.ts`
- Line 96: update guideline — remove `glob, grep` from the list of dedicated tools:  
  `"Prefer dedicated tools (read, replace, insert) over shell for file operations."`
- Line 101: update tool output format note — remove mention of `grep` prefixing lines  
  (only `read` adds the `line:hash|` prefix now):  
  `` `read` prefixes every line with `line:hash|` … ``

### `src/agent/tools.test.ts`
- No glob/grep-specific tests exist here, but verify the `buildReadOnlyToolSet` test no longer expects glob/grep (it currently doesn't assert on them, so it should be fine as-is).

---

## 3. Cleanup pass

### `src/agent/system-prompt.ts` — SKILL.md reference
The skill file (`SKILL.md`) lists `glob` and `grep` as core tools; update it once the tools are removed.  
File: `.agents/skills/mini-coder/SKILL.md` — remove `glob` and `grep` from the tools table, remove hook references for those tools.

### `src/agent/tools.test.ts`
- After removing tools, confirm no lingering `"glob"` / `"grep"` name checks remain.

### Verify no other source files import from `glob.ts`, `grep.ts`, `ignore.ts`, or `scan-path.ts`
- Run `knip` / `typecheck` after deletions to surface any missed references.

---

## 4. Verification

```bash
bun run jscpd && bun run knip && bun run typecheck && bun run format && bun run lint && bun run test
```

All checks must pass cleanly before closing out.

---

## Touch-list (ordered)

| # | File | Action |
|---|------|--------|
| 1 | `src/index.ts` | Return after one-shot prompt instead of entering input loop |
| 2 | `src/cli/args.ts` | Fix help comment for prompt example |
| 3 | `src/tools/glob.ts` | Delete |
| 4 | `src/tools/glob.test.ts` | Delete |
| 5 | `src/tools/grep.ts` | Delete |
| 6 | `src/tools/grep.test.ts` | Delete |
| 7 | `src/tools/ignore.ts` | Delete |
| 8 | `src/tools/scan-path.ts` | Delete |
| 9 | `src/agent/tools.ts` | Remove glob/grep imports, registrations, HOOKABLE_TOOLS entries |
| 10 | `src/tools/hooks.ts` | Remove `hookEnvForGlob`, `hookEnvForGrep` |
| 11 | `src/agent/system-prompt.ts` | Update guidelines and tool-output-format text |
| 12 | `.agents/skills/mini-coder/SKILL.md` | Remove glob/grep from tools table and hooks list |
| 13 | Verify | `bun run jscpd && bun run knip && … && bun run test` |
