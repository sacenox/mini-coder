# Mini Coder repo for agents:

- App data folder is in `~/.config/mini-coder/`. It includes sqlite db file and logs.
- Core idea is in [mini-coder-idea.md](mini-coder-idea.md); READ IT. This file is managed by the user, don't edit unless asked to by the user. Treat this as the source of truth for the design/implementation.
- README.md is cosmetic for users, don't edit unless asked to.
- Write minimal tests, focused on our code's logic. Never test dependencies. Never use mocks or stubs.
- Keep the repo pristine: no failing tests, no lint, no build issues, no `ignore`-style comments. No failing hooks.
- Verify your changes, you can use the shell tool and `tmux` to test as needed.
- Use `bun run format` to fix formatting issues.
- We care about performance.
- Do not inline `import` calls. Don't duplicate code. Don't leave dead code behind.
- Don't re-implement helpers/functionality that already exists, always consolidate.
- Don't add complexity for backwards compatibility, it's preferable to break compatibility and keep the code simple.
- Don't make random test files, if you need to test something, write a propper unit test.
- If you make temp files, clean them up when you are done.
- Use Conventional Commits formatting for commit messages. When you commit, include the whole diff unless told otherwise.
