# Mini coder next

A new version of mini-coder, written from the ground up as library first, plugins.
Version `mini-coder@0.5.x` is currently stable and mostly complete, thats our reference implementation.
Benchmarking from the start, keep the agent dumb, build the plugin-library-first architecture, then
run a an automated benchmarking loop to shape/hone the harness.

## Core dependencies

**https://github.com/badlogic/pi-mono/tree/main/packages/ai**

Plain text readme file: https://raw.githubusercontent.com/badlogic/pi-mono/refs/heads/main/packages/ai/README.md

- Provider nomrmalized api, supports oauth logins.

**https://github.com/sacenox/cel-tui**

- Complete TUI framework, inspired by flexbox.

**Bun.js**

- `bun` and `bunx` are prefered over their node/npm/yarn/pnpm counter-parts.

**Typescript**

- Use typescript with advanced types always.
- Typescript files should be modules with exports over classes.
- Hoist variables, define helpers before using them, ensure code reads well for humans.

## Benchmarks

- Please see `BENCHMARK.md` for Terminal Bench benchmark info, and how to run it.
- Never run more than 2 concurrent evals.

## Formating and linting

**Always format before linting**

- Format root `*.md` files: `bunx prettier --write *.md`
- Format typescript files: `bunx biome format --write`

Then lint with: `bunx biome check` and `tsc --noEmit`.

> Always fix any warnings or errors even if they were not introduced by you, prefer non destructive fixes.
