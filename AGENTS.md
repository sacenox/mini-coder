# Mini Coder — Agent Instructions

- This repo expects agents to use the `programming-practices` skill at all times.
- **Spec-driven development**: `spec.md` is the source of truth for behavior and design. Read it before changing code. Do not deviate without discussion.
- Use Conventional Commits formatting for commit messages.
- Before committing code changes, review the diff with the user and get approval for the commit.

## Session bootstrap

- Check `PROGRESS.md` to check if there are any ongoing tasks.
- For audits, treat open `TODO.md` items as already-known issues and focus findings on new gaps unless the user asks to re-check known debt.
- Keep `TODO.md` minimal and current; remove completed items instead of accumulating history.

## Code map

- `src/index.ts` — startup, providers, settings, AGENTS.md/skills loading, theme assembly, shared app state.
- `src/agent.ts` — streaming model loop, tool dispatch, agent events.
- `src/tools.ts` — built-in tools and truncation logic.
- `src/session.ts` — SQLite persistence, turn numbering, undo/fork, prompt history, cumulative stats.
- `src/prompt.ts`, `src/skills.ts` — prompt assembly and external context discovery/loading.
- `src/ui.ts` — cel-tui lifecycle and top-level orchestration.
- `src/ui/agent.ts` — input submission, streaming state, agent-loop wiring.
- `src/ui/commands.ts` — slash commands and Select overlays.
- `src/ui/conversation.ts`, `src/ui/status.ts`, `src/ui/input.ts`, `src/ui/help.ts`, `src/ui/overlay.ts` — focused rendering/helpers.

## Repo

- Runtime: Bun. Use `bun run`, `bun test`, `bun install`, `bunx`.
- Toolchain split: **prettier** formats, **biome** lints + sorts imports. CI runs `bun test`, `bun run check`, `bun run format`, and `bun run typecheck`. Lefthook runs the same steps sequentially.
- App data dir: `~/.config/mini-coder/`.
- Published CLI entrypoint is `mc` via `bin/mc.ts` → `src/index.ts`. Do not point `package.json#bin` at `dist/` unless publish actually produces it.
- For self-review or audit passes, use mini-coder in headless mode from the repo root, e.g. `mc -p "review the current diff"`.
- All exports need JSDoc; interface fields get single-line JSDoc. See `session.ts` for the pattern.
- Dependency references:
  - pi-ai: `~/src/pi-mono/packages/ai/` (`src/types.ts`, `src/stream.ts`, `src/utils/oauth/`, `src/providers/faux.ts`)
  - cel-tui: `~/src/cel-tui/` (`~/src/cel-tui/spec.md`, `examples/chat.ts`)

## Release process

- Release instructions live here now; do not rely on `.agents/skills/release`.
- This repo does not have a build step. Do not run `bun run build` for releases.
- The published package ships the checked-in Bun launcher (`bin/mc.ts`), runtime source (`src/index.ts`), and `README.md` so npm shows the package docs. The release-time publishability check is `bun pm pack --dry-run --ignore-scripts`.
- Before mutating anything for a release:
  - ensure the current branch is `main`
  - ensure `git status --porcelain` is empty
  - run `git fetch origin --tags` and ensure `HEAD` matches `origin/main`
  - read `package.json` to capture the package `name` and release `version`
  - if `package.json` is already ahead of npm, treat that version as the intended release version and do not bump again unless the user explicitly asks
  - ensure `git tag v<version>` does not already exist locally or on origin
  - ensure `npm view <name>@<version> version` does not already exist
- Release verification suite:
  - `bun test`
  - `bun run check`
  - `bun run format`
  - `bun run typecheck`
  - `bun pm pack --dry-run --ignore-scripts` and confirm the packed file list includes `README.md`
- Pre-release docs sync:
  - audit `README.md` against `spec.md` and the current command/CLI sources (`src/input.ts`, `src/ui/help.ts`, `src/cli.ts`, `src/headless.ts`, `package.json`)
  - update `README.md` on `main` first
  - update the `gh-pages` branch in a separate `git worktree`
  - sync `README.md`, `spec.md`, and `AGENTS.md` into that `gh-pages` worktree so the branch does not keep stale repo docs
  - update `gh-pages/index.html` so its install, features, commands, and headless-mode copy matches the repo docs and current behavior
  - review the `gh-pages` diff before committing or pushing it
- Release flow:
  - if the version needs to change, update only `package.json`
  - review the diff with the user before committing
  - commit with `chore: release v<version>`
  - create an annotated tag `v<version>`
  - push `main` and the exact tag explicitly
  - run `npm publish --ignore-scripts`
  - verify the publish with `npm view <name>@<version> version`
- If any check fails, stop and report the failure instead of improvising around it.

## Project rules

- No inline `import` calls, duplicated helpers, dead code, or speculative abstractions.
- Performance matters. Prefer fast paths.
- Don't over-optimize, let the problems reveal themselves first.
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
- Prompt context has explicit reload boundaries: AGENTS.md content and discovered skills are stable within a session and should refresh only at boundaries like `/new` or CWD change.
- Tool safety truncation and UI `/verbose` preview are separate layers. Do not conflate them.
- Avoid accretive growth. When a file starts absorbing unrelated behavior, split it at a real seam instead of appending more helpers. Prefer explicit state ownership over module globals, shared helpers over copy-modify text/state logic, and typed boundaries over `Record<string, unknown>` plus downstream casts.
- Before 1.0, prefer correct/simple semantics over speculative compatibility shims, but call out intentional breaking changes.
- TUI changes need real terminal validation in `tmux`; passing tests is not enough.
- Stay within the agreed TODO scope. Do not pull in adjacent items without discussion.
- Don't write tests that call real git commands.
- For test work, read and follow the `testing-practices` skill, not just the generic coding guidance.
- Don't add brittle tests that pin incidental wording, formatting, colors, layout, render-tree plumbing, tokenizer scopes, or other implementation-shaped output unless that exact output is the actual contract.
- In UI tests, prefer real input paths and user-visible outcomes over poking `props.onKeyPress`, focus internals, or syntax-theme objects directly.
