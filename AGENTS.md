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

## Coding style

- Prefer small named functions and plain exported objects over classes or heavy abstractions.
- Keep imports grouped as node built-ins, external packages, then local modules. Use `type` imports for types.
- Use 2-space indentation, semicolons, double quotes, and trailing commas in multiline literals/calls.
- Name values with `camelCase`, types/schemas/TUI components with `PascalCase`, and fixed defaults with `SCREAMING_SNAKE_CASE`.
- Model state and events with explicit TypeScript types, discriminated unions, and TypeBox schemas for persisted or parsed data.
- Use early returns and guard clauses for validation, missing files, aborts, and fallback cases.
- Prefer Bun APIs (`Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.Glob`) for runtime, file, and process work.
- Keep async flows readable with `async` functions/generators, `for await`, and explicit `AbortSignal` handling before writes or long work.
- In tool runners, report recoverable failures as tool result text instead of throwing; reserve thrown `Error`s for caller-facing validation failures.
- Comments should explain why something exists or document non-obvious behavior; use `TODO:` for known follow-up work.

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
