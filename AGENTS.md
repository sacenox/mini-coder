# Mini Coder repo for agents:

- App data folder is in `~/.config/mini-coder/`. It includes sqlite db file and logs.
- README.md is cosmetic for users, don't edit unless asked to.
- `docs/KNOWN_ISSUES.md` tracks known issues. `docs/mini-coder.1.md` is the man page.
- Create or reuse the `TODO.md` file to track your progress in long tasks. Remove completed items, keep it clean, concise, and up to date at all times. Track it in git.
- Write minimal tests, focused on our code's logic. Never test dependencies. Never use mocks or stubs.
- Keep the repo pristine: no failing tests, no lint, no build issues, no `ignore`-style comments. No failing hooks.
- Verify your changes, you can use the shell tool and `tmux` to test as needed.
- **tmux send-keys rules**: always use `-l` for text (`tmux send-keys -t s -l 'text'`), then send `Enter` separately without `-l` (`tmux send-keys -t s Enter`). Without `-l`, words like `Enter`, `Escape`, `Tab`, `Space` are interpreted as key presses.
- Use `bun run format` to fix formatting issues.
- We care about performance.
- Do not inline `import` calls. Don't duplicate code. Don't leave dead code behind.
- Don't re-implement helpers/functionality that already exists, always consolidate.
- Don't add complexity for backwards compatibility, it's preferable to break compatibility and keep the code simple.
- Don't make random test files, if you need to test something, write a proper unit test.
- If you make temp files, clean them up when you are done.
- Before committing, run `git status` and ensure every modified and untracked file produced during the session is included. Do not leave files behind.
- Use Conventional Commits formatting for commit messages.
- Before committing code changes, review the diff with the user and get approval for the commit. Treat direct user requests to commit or to do repository tasks as approval.
