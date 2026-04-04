# Implementation plan

## Phase 1 — Foundation (no UI, no LLM)

- [ ] `session.ts` — SQLite schema, CRUD, turn numbering, undo, fork, cumulative stats
- [ ] `tools.ts` — edit (exact-text replace, new file creation) and shell (exec, output truncation)
- [ ] `git.ts` — branch, dirty counts, ahead/behind, repo root detection

## Phase 2 — Context assembly

- [ ] `skills.ts` — SKILL.md discovery, frontmatter parsing, catalog generation, name collision resolution
- [ ] `prompt.ts` — AGENTS.md discovery, system prompt construction (base + AGENTS.md + skills + plugins + git footer)

## Phase 3 — Agent loop

- [ ] `agent.ts` — core loop: stream → handle events → execute tools → loop. Interrupt handling. Context limit / compaction.
- [ ] `plugins.ts` — plugin loader, init/destroy lifecycle, tool + prompt injection
- [ ] `readImage` tool — base64 encoding, mime detection, conditional registration

## Phase 4 — UI

- [ ] `ui.ts` — cel-tui layout (log + input + status bar), state management, message rendering
- [ ] `index.ts` — entry point, provider discovery, startup sequence, command routing
- [ ] Commands — `/model`, `/session`, `/new`, `/fork`, `/undo`, `/reasoning`, `/verbose`, `/login`, `/logout`, `/help`
- [ ] Input handling — `/skill:name` parsing, image path detection, Tab file autocomplete
