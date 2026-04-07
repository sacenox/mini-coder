# Mini Coder — Agent Instructions

- **Spec-driven development**: `spec.md` is the source of truth for behavior and design. Read it before changing code. Do not deviate without discussion.
- **TDD**: write tests first, then implement.
- Use Conventional Commits formatting for commit messages.
- Before committing code changes, review the diff with the user and get approval for the commit.

## Session bootstrap

- Read `spec.md`, then `TODO.md`, then inspect `git status --short` / `git diff`.
- Treat `TODO.md` as the current verified work queue. For spec-alignment work, confirm the mismatch in code before editing.
- Keep `TODO.md` minimal and current; remove completed items instead of accumulating history.

## Code map

- `src/index.ts` — startup, providers, settings, AGENTS.md/skills/plugins loading, theme assembly, shared app state.
- `src/agent.ts` — streaming model loop, tool dispatch, agent events.
- `src/tools.ts` — built-in tools and truncation logic.
- `src/session.ts` — SQLite persistence, turn numbering, undo/fork, prompt history, cumulative stats.
- `src/prompt.ts`, `src/skills.ts`, `src/plugins.ts` — prompt assembly and external context discovery/loading.
- `src/ui.ts` — cel-tui lifecycle and top-level orchestration.
- `src/ui/agent.ts` — input submission, streaming state, agent-loop wiring.
- `src/ui/commands.ts` — slash commands and Select overlays.
- `src/ui/conversation.ts`, `src/ui/status.ts`, `src/ui/input.ts`, `src/ui/help.ts`, `src/ui/overlay.ts` — focused rendering/helpers.

## Repo

- Runtime: Bun. Use `bun run`, `bun test`, `bun install`, `bunx`.
- Toolchain split: **prettier** formats, **biome** lints + sorts imports. CI runs `bun test`, `bun run check`, `bun run format`, and `bun run typecheck`. Lefthook runs the same steps sequentially.
- App data dir: `~/.config/mini-coder/`.
- Local manual CLI testing on this machine uses `bun add -g /home/xonecas/src/mini-coder`, which links the working tree into `~/.bun/bin/mc`.
- Published CLI entrypoint is `mc` via `bin/mc.ts` → `src/index.ts`. Do not point `package.json#bin` at `dist/` unless publish actually produces it.
- All exports need JSDoc; interface fields get single-line JSDoc. See `session.ts` for the pattern.
- Dependency references:
  - pi-ai: `~/src/pi-mono/packages/ai/` (`src/types.ts`, `src/stream.ts`, `src/utils/oauth/`, `src/providers/faux.ts`)
  - cel-tui: `~/src/cel-tui/` (`~/src/cel-tui/spec.md`, `examples/chat.ts`, `packages/components/src/markdown.ts`)

## Project rules

- No inline `import` calls, duplicated helpers, dead code, or speculative abstractions.
- Performance matters. Prefer fast paths.
- Study dependency examples, types, and tsconfig before integrating them. Match their patterns instead of fighting them.
- Use dependency-defined types, not weaker substitutes. Do not hide type/config mismatches with casts or ignores.
- For UI work, verify both light/dark terminal legibility and let the layout engine size things.

## Durable lessons

- Don't add future-facing `biome-ignore`, `@ts-ignore`, or impossible type guards.
- Event APIs must carry the data handlers need; do not reconstruct it from unrelated state.
- Async callbacks must catch returned promises.
- In cel-tui `onKeyPress`, return `false` only for keys you explicitly intercept. Escape often needs `onBlur`, not `onKeyPress`.
- When adding provider/tool options, trace them through the full call chain (for example `apiKey` into `streamSimple`).
- UI/info messages may live in the persisted log and in `state.messages`, but they must stay marked as UI-only (`role: "ui"`, `turn = NULL`) and always be filtered out of model context.
- Prompt context has explicit reload boundaries: AGENTS.md content, discovered skills, and plugin prompt suffixes are stable within a session and should refresh only at boundaries like `/new` or CWD change.
- Tool safety truncation and UI `/verbose` preview are separate layers. Do not conflate them.
- The plugin API is still in spec-alignment cleanup. Current repo reality is `tools` plus `toolHandlers`; treat that as temporary, not settled design.
- Before 1.0, prefer correct/simple semantics over speculative compatibility shims, but call out intentional breaking changes.
- TUI changes need real terminal validation in `tmux`; passing tests is not enough.
- Stay within the agreed TODO scope. Do not pull in adjacent items without discussion.

## Testing strategy

- Test boundaries, not dependencies. Use real Bun/git/sqlite/pi-ai faux behavior. No mocks or stubs.
- `tools.ts`: edit exact-match/create/path/newline preservation; shell exit/abort/truncation/cwd; readImage mime/errors/path handling.
- `session.ts`: CRUD, turn numbering, undo/fork, truncation, prompt history, cumulative stats.
- `prompt.ts` / `skills.ts`: prompt assembly order, AGENTS.md ordering/scan-root behavior, skill discovery/catalog, conditional `readImage` omission.
- `agent.ts`: faux-provider end-to-end loop tests for tool execution, ordering, interrupts, and errors.
- UI tests live in `src/ui*.test.ts` plus focused `src/ui/*.ts` module tests; TUI rendering/input changes still need manual terminal validation.
- `input.ts` and `theme.ts`: command/skill/image priority, theme completeness, merge semantics.
