# Remove `/plan` Mode

## Goal
Remove `/plan` mode entirely from mini-coder so there is no CLI command, runtime state, prompt decoration, or read-only tool path associated with it.

## Scope
- Remove the `/plan` slash command and help/manpage references.
- Remove `planMode` state and setters from CLI/runtime wiring.
- Remove the read-only toolset branch used only by `/plan` mode.
- Update or remove tests that cover `/plan` mode.
- Keep `/ralph` behavior intact.

## Validation
Run:
- `bun run jscpd`
- `bun run knip`
- `bun run typecheck`
- `bun run format`
- `bun run lint`
- `bun run test`
