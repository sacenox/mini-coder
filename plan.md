# Codebase Organization Plan

## 1. Extract CLI Argument Parsing
**Issue**: `src/index.ts` is overly large and mixes bootstrapping with CLI argument parsing and help rendering.
**Action**: Extract `parseArgs`, `printHelp`, and `CliArgs` interface into a new file `src/cli/args.ts`. Keep `src/index.ts` focused on initializing the environment and invoking the main loops.

## 2. Decouple `src/agent/` and `src/cli/` (Input Loop)
**Issue**: `src/agent/input-loop.ts` relies heavily on CLI concerns (e.g., `readline`, `handleCommand`, `CommandContext`). It creates a circular dependency between `agent` and `cli`.
**Action**: Move `src/agent/input-loop.ts` to `src/cli/input-loop.ts`. This correctly places the interactive terminal logic within the CLI domain.

## 3. Extract Status Bar Payload Construction
**Issue**: `src/agent/agent.ts` contains `renderStatusBarForSession`, which fetches the git branch and formats paths (`tildePath`) to update the CLI UI. This mixes UI logic with core agent initialization.
**Action**: Move `renderStatusBarForSession` (and its dependencies like `getGitBranch`) out of `agent.ts` and into `src/cli/input-loop.ts` or a dedicated UI bridge file.

## 4. Move CLI-specific Helpers out of Agent
**Issue**: `src/agent/agent-helpers.ts` contains `runShellPassthrough` (CLI), `resolveFileRefs` (CLI syntax parsing for `@`), and `hasRalphSignal`.
**Action**: Move `runShellPassthrough` and `resolveFileRefs` into `src/cli/`. They deal with user input and terminal output, not core LLM agent logic.

## 5. Domain Cleanup
**Issue**: `src/agent/agent.ts` exports `CommandContext`, which is defined in `src/cli/commands.ts`.
**Action**: Clean up interfaces so that `src/cli/` depends on `src/agent/` and not vice-versa, achieving a clear one-way dependency flow.
