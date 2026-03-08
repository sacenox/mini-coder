# Agent Task: Resolve JSCPD Clones

Your goal is to eliminate all code duplication reported by `jscpd` in the `src/` directory.

## Instructions:
1. Run `bun run jscpd` to identify code clones.
2. Pick **one** duplication issue reported by the tool.
3. Refactor the code to eliminate the clone. This might involve:
   - Extracting shared logic into a common utility function.
   - Using loops or higher-order functions.
   - Abstracting classes or types.
4. Run `bun run knip && bun run typecheck && bun run format && bun run lint && bun test` to ensure your changes did not break the project.
5. If the tests or checks fail, fix them before moving on.
6. Re-run `bun run jscpd`.
7. Repeat steps 2-6 until `bun run jscpd` reports 0 clones.
8. When 0 clones are reported, state "All jscpd clones resolved." and finish the loop.

**Important rules**:
- Keep your refactoring clean and targeted. Do not rewrite large chunks of unaffected code.
- Ensure you do not leave dead code behind.
- Respect existing project style and architecture.
