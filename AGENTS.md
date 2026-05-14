# Mini coder next

A barebones, fast coding agent

## Core dependencies

**https://github.com/badlogic/pi-mono/tree/main/packages/ai**

Plain text readme file: https://raw.githubusercontent.com/badlogic/pi-mono/refs/heads/main/packages/ai/README.md

- Provider normalized API, supports oauth logins.

**https://github.com/sacenox/cel-tui**

- Complete TUI framework, inspired by flexbox.

**Bun.js**

- `bun` and `bunx` are preferred over their node/npm/yarn/pnpm counterparts.

**Typescript**

- Use typescript with advanced types always.
- Typescript files should be modules with exports over classes.
- Hoist variables, define helpers before using them, ensure code reads well for humans.

## Benchmarks

- Please see `BENCHMARK.md` for Terminal Bench benchmark info, and how to run it.
- Never run more than 2 concurrent evals.

## Formatting and linting

**Always format before linting**

- Format root `*.md` files: `bunx prettier --write *.md`
- Format typescript files: `bunx biome format --write`

Then lint with: `bunx biome check` and `tsc --noEmit`.

**Do not use the `package.json` commands/scripts they are for the users.** Use the commands above instead.

> Always fix any warnings or errors even if they were not introduced by you, prefer non destructive fixes.
