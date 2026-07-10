# Mini coder next

A barebones, fast coding agent

## Engineering priorities

In order of importance:

1. Correctness for the current, verified requirement.
2. The fewest new concepts, files, types, state, and code paths.
3. Readability and long-term maintainability.
4. Extensibility only when explicitly required.

When multiple solutions are correct, choose the one with the smallest maintenance surface.

## Core dependencies

**https://github.com/badlogic/pi-mono/tree/main/packages/ai**

Plain text readme file: https://raw.githubusercontent.com/badlogic/pi-mono/refs/heads/main/packages/ai/README.md

- Provider normalized API, supports oauth logins.

**https://github.com/sacenox/cel-tui**

- Complete TUI framework, inspired by flexbox.

**Bun.js**

- `bun` and `bunx` are preferred over their node/npm/yarn/pnpm counterparts.

**TypeScript**

- Prefer inferred local types and plain object types.
- Use generics, conditional types, schemas, and other advanced type machinery only when they provide concrete compile-time value for a current requirement.
- Prefer modules and functions over classes, but keep exports minimal.
- Define helpers near their use and only extract them when they name a meaningful operation or remove substantial repetition.
- Keep constants local unless they are genuinely shared configuration.
- Use `SCREAMING_SNAKE_CASE` only for module-level constants that are intentionally shared within that module.

## Simplicity and scope

- Trace the actual data flow before designing a fix. Apply guards at the narrowest boundary where the invariant matters.
- Solve the current observed requirement. Do not add behavior for hypothetical future consumers, reuse, or failure modes.
- Keep values and implementation details in the narrowest lexical scope possible.
- Inline single-use constants and trivial logic.
- Do not create a new module, exported API, type, state object, or configurable abstraction for a single caller unless it substantially clarifies the code.
- Prefer a small amount of local duplication over a premature shared abstraction. Extract shared code when multiple real callers require the same policy.
- Prefer deleting or replacing obsolete code over layering new behavior around it.
- Do not harden adjacent systems unless the requested change depends on it.
- Preserve unrelated behavior and avoid opportunistic refactors.
- If a change introduces a new abstraction or touches an unrelated subsystem, explain why before implementing it.

## Coding style

- Prefer plain functions and objects over classes or heavy abstractions.
- Keep imports grouped as node built-ins, external packages, then local modules. Use `type` imports for types.
- Use 2-space indentation, semicolons, double quotes, and trailing commas in multiline literals/calls.
- Name values with `camelCase` and types, schemas, and TUI components with `PascalCase`.
- Use explicit types and discriminated unions for non-trivial state and events. Use TypeBox schemas for persisted or parsed data.
- Use early returns and guard clauses for validation, missing files, aborts, and fallback cases.
- Prefer Bun APIs (`Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.Glob`) for runtime, file, and process work.
- Keep async flows readable with `async` functions/generators, `for await`, and explicit `AbortSignal` handling before writes or long work.
- In tool runners, report recoverable failures as tool result text instead of throwing; reserve thrown `Error`s for caller-facing validation failures.
- Comments should explain why something exists or document non-obvious behavior; use `TODO:` for known follow-up work.

## Before finishing

After implementing and before formatting or linting, review the diff and ask:

- Did I solve the requirement at the correct boundary?
- Did I add behavior the user did not request?
- Can any new file, export, type, helper, constant, or mutable state be removed or made local?
- Is every changed file necessary?
- Is there a direct solution with fewer concepts?
- Did I preserve unrelated behavior?

Simplify the patch before reporting completion.

## Benchmarks

- Please see `BENCHMARK.md` for Terminal Bench benchmark info, and how to run it.
- Never run more than 2 concurrent evals.

## Formatting and linting

**Always format before linting**

- Format root `*.md` files: `bunx prettier --write *.md`
- Format typescript files: `bunx biome format --write`

Then lint with: `bunx biome check` and `bunx tsc --noEmit`. (Do not expect to see tsc in PATH).

**Do not use the `package.json` commands/scripts they are for the users.** Use the commands above instead.

> Fix warnings and errors introduced by the patch. Report unrelated existing failures instead of expanding the task unless the user asks you to fix them.
