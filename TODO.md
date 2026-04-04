# Implementation plan

## Phase 1 — Foundation (no UI, no LLM)

- [x] `session.ts` — SQLite schema, CRUD, turn numbering, undo, fork, cumulative stats
- [x] `session.test.ts` — 20 tests against real in-memory bun:sqlite
- [ ] `tools.ts` — `edit` (exact-text replace, new file creation) and `shell` (exec, output truncation)
- [ ] `tools.test.ts` — pure function tests per AGENTS.md testing strategy
- [ ] `git.ts` — branch, dirty counts, ahead/behind, repo root detection

### Notes from Phase 1

- `session.ts` exports: `openDatabase`, `createSession`, `getSession`, `listSessions`, `deleteSession`, `appendMessage`, `loadMessages`, `undoLastTurn`, `forkSession`, `computeStats`.
- Internal row types (`SessionRow`, `MaxTurnRow`, `DataRow`) and a `SQL` constants object keep queries centralized and avoid formatter conflicts.
- `@mariozechner/pi-ai` is the only runtime dependency so far. Its `Message`, `AssistantMessage`, `UserMessage`, `ToolResultMessage` types are used for session persistence.

## Phase 2 — Context assembly

- [ ] `skills.ts` — SKILL.md discovery, frontmatter parsing, catalog generation, name collision resolution
- [ ] `prompt.ts` — AGENTS.md discovery, system prompt construction (base + AGENTS.md + skills + plugins + git footer)

### Phase 2 entry points

- `skills.ts` depends on nothing from Phase 1. It scans directories for `SKILL.md` files, parses YAML frontmatter (name, description), resolves name collisions (project-level wins over user-level), and generates the XML catalog string for the system prompt. See spec.md "Agent Skills" section.
- `prompt.ts` depends on `skills.ts` and `git.ts`. It walks from CWD to scan root collecting `AGENTS.md`/`CLAUDE.md` files, assembles the full system prompt in construction order (base → AGENTS.md → skills catalog → plugin suffixes → session footer with date/cwd/git). See spec.md "System prompt" section.
- `git.ts` (from Phase 1) is needed by `prompt.ts` for the session footer git line.

## Phase 3 — Agent loop

- [ ] `agent.ts` — core loop: stream → handle events → execute tools → loop. Interrupt handling. Context limit / compaction.
- [ ] `plugins.ts` — plugin loader, init/destroy lifecycle, tool + prompt injection
- [ ] `readImage` tool — base64 encoding, mime detection, conditional registration

## Phase 4 — UI

- [ ] `ui.ts` — cel-tui layout (log + input + status bar), state management, message rendering
- [ ] `index.ts` — entry point, provider discovery, startup sequence, command routing
- [ ] Commands — `/model`, `/session`, `/new`, `/fork`, `/undo`, `/reasoning`, `/verbose`, `/login`, `/logout`, `/help`
- [ ] Input handling — `/skill:name` parsing, image path detection, Tab file autocomplete
