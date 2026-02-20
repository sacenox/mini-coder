# Mini Coder repo for agents:

- App data folder is in `~/.config/mini-coder/`. It includes sqlite db file.
- Core idea is in [mini-coder-idea.md](mini-coder-idea.md). This file is managed by the user, don't edit unless asked to by the user.
- README.md is cosmetic for users, don't edit unless asked to.
- Write minimal tests, focused on our code's logic. Never test dependencies. Never use mock servers or stubs.
- Keep the repo pristine: no failing tests, no lint, no build issues, no `nolint:` comments.
- Use `bun run typecheck && bun run format && bun run lint` to check your changes.
