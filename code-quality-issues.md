# Code Quality Issues

## 1. 🔴 Duplicate Code — `parseFrontmatter` tripled across modules

`parseFrontmatter` (including its `Frontmatter` interface, `FM_RE` regex and YAML key-parsing loop) is **copy-pasted verbatim** in three files:

- `src/cli/agents.ts` (lines 20–45)
- `src/cli/custom-commands.ts` (lines 20–45)
- `src/cli/skills.ts` has a partial version `parseSkillMeta` that reads `name` and `description` from the same format.

The agents and custom-commands versions are byte-for-byte identical — same regex, same loop, same trim/strip-quotes, same `description`/`model` key handling. The only difference is the struct they populate. Fix: extract into a shared `src/cli/frontmatter.ts` utility and import it in all three.

---

## 2. 🔴 Duplicate Code — `loadFromDir` pattern tripled

The `loadFromDir` function in `agents.ts` and `custom-commands.ts` is essentially the same skeleton: `existsSync` check → `readdirSync` → `.endsWith(".md")` filter → `readFileSync` → `parseFrontmatter` → `Map.set`. The `loadSkills` version differs only in that it looks for `SKILL.md` inside subdirectories instead of `.md` flat files, but the rest of the structure is the same. Same for the public `loadXxx(cwd)` function: three identical "merge global + local, local wins" patterns.

---

## 3. 🔴 Duplicate Code — `homedir()`-based `cwdDisplay` computed in two places in `agent.ts`

```ts
// buildSystemPrompt (line 98-100)
const cwdDisplay = cwd.startsWith(homedir())
    ? `~${cwd.slice(homedir().length)}`
    : cwd;

// renderStatusBarForSession (line 646-648)
const cwdDisplay = cwd.startsWith(homedir())
    ? `~${cwd.slice(homedir().length)}`
    : cwd;
```

Also duplicated in `session/manager.ts` (line 53–55) and `cli/output.ts` already has `HOME = homedir()` cached at the top. This pattern should be a small helper function, e.g. `tildePath(p: string): string`.

---

## 4. 🔴 Inlined `import()` calls — violates project rule

The rule says **"Do not inline `import` calls"**. There are 12 occurrences of dynamic inline type imports:

- `src/agent/agent.ts` lines 197, 224, 673 — `import("../tools/subagent.ts").SubagentOutput`, `SubagentToolEntry`, `CoreMessage`
- `src/agent/tools.ts` line 104 — `import("../tools/subagent.ts").SubagentOutput`
- `src/cli/commands.ts` line 44 — `import("../tools/subagent.ts").SubagentOutput`
- `src/cli/output.ts` lines 332, 342, 512, 579, 597 — `SubagentToolEntry`, `SubagentOutput`, `CoreMessage`
- `src/llm-api/types.ts` line 81 — `import("../llm-api/turn.ts").CoreMessage`
- `src/llm-api/turn.ts` line 32 — `import("ai").FlexibleSchema<unknown>`

All of these should be top-level `import type` statements.

---

## 5. 🟡 Dead code — `userMessage` in `turn.ts` is never called

`src/llm-api/turn.ts` line 185 exports `userMessage(text: string): CoreMessage`. It is never imported or called anywhere in the codebase. It should be removed.

---

## 6. 🟡 Dead code — `availableProviders` imported but never used

`src/cli/commands.ts` imports `availableProviders` from `providers.ts` (line 3) but it is never referenced anywhere in that file (only `fetchAvailableModels` is used). This is an unused import.

---

## 7. 🟡 Dead code — `saveMessage` (singular) exported but never used

`src/session/db.ts` exports `saveMessage` (single-message variant, line 191). The entire codebase always calls `saveMessages` (plural). `saveMessage` has no callers and should be removed.

---

## 8. 🟡 Dead code — `updateSessionTitle` and `deleteSession` exported but never called

`src/session/db.ts` exports `updateSessionTitle` (line 161) and `deleteSession` (line 185). Neither appears in any other file. They may be future API surface, but currently they are dead exports.

---

## 9. 🟡 Dead code — most of `src/llm-api/types.ts` is orphaned

`ProviderConfig`, `MessageRole`, `TextContent`, `ToolCallContent`, `ToolResultContent`, `MessageContent`, and `Message` are all defined and exported in `types.ts` but **never imported anywhere**. The codebase uses `CoreMessage` from `turn.ts` directly for all message handling. The only things from `types.ts` that are actually used are `ToolDef` and the `TurnEvent` family. The unused types should be removed.

---

## 10. 🟡 Unused import — `relative` in `session/manager.ts`

`src/session/manager.ts` line 2 imports `relative` from `"node:path"` but it is never used anywhere in the file.

---

## 11. 🟡 Unused import — `PREFIX` in `session/manager.ts`

`src/session/manager.ts` line 4 imports `PREFIX` from `"../cli/output.ts"` but it is not used anywhere in the file (only `writeln` and `c` from `yoctocolors` are used in `printSessionList`).

---

## 12. 🟡 Bug-prone — `zenGoogle` ignores its parameter and recreates provider on each call

`providers.ts` line 78: `zenGoogle(modelId: string)` takes `modelId` but only uses it to pass to `createGoogleGenerativeAI` (which doesn't use it — the model ID is passed to the returned function). Also unlike the other zen providers, `zenGoogle` doesn't memoize — it creates a new `createGoogleGenerativeAI` instance on every call. This is inconsistent and wasteful.

---

## 13. 🟡 Minor — double `homedir()` call per `cwdDisplay` computation

In `buildSystemPrompt` and `renderStatusBarForSession` (agent.ts), `homedir()` is called twice inline:
```ts
cwd.startsWith(homedir()) ? `~${cwd.slice(homedir().length)}` : cwd
```
`homedir()` is cheap but its result is constant — it should be captured once (as `output.ts` already does with `const HOME = homedir()`).

---

## 14. 🟢 Style — `eslint-disable` comments in `mcp/client.ts`

Lines 81 and 88 in `mcp/client.ts` contain `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comments. The project uses Biome, not ESLint — these comments are dead noise and have no effect. They should be removed.

---

## Summary

| # | Severity | File(s) | Issue |
|---|---|---|---|
| 1 | 🔴 | `agents.ts`, `custom-commands.ts`, `skills.ts` | `parseFrontmatter` duplicated 3× |
| 2 | 🔴 | same 3 files | `loadFromDir` + merge pattern duplicated 3× |
| 3 | 🔴 | `agent.ts` (×2), `manager.ts` | `cwdDisplay` tilde logic duplicated |
| 4 | 🔴 | 6 files (12 occurrences) | Inlined `import()` type calls — project rule violation |
| 5 | 🟡 | `turn.ts` | `userMessage` exported but never used |
| 6 | 🟡 | `commands.ts` | `availableProviders` imported but never used |
| 7 | 🟡 | `db.ts` | `saveMessage` (singular) exported but never called |
| 8 | 🟡 | `db.ts` | `updateSessionTitle`, `deleteSession` — dead exports |
| 9 | 🟡 | `types.ts` | `ProviderConfig`, `Message`, `MessageRole`, etc. — never imported |
| 10 | 🟡 | `manager.ts` | `relative` imported but not used |
| 11 | 🟡 | `manager.ts` | `PREFIX` imported but not used |
| 12 | 🟡 | `providers.ts` | `zenGoogle` doesn't memoize, ignores its parameter |
| 13 | 🟡 | `agent.ts` | `homedir()` called twice per expression |
| 14 | 🟢 | `mcp/client.ts` | Dead `eslint-disable` comments (project uses Biome) |
