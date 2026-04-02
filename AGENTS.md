# Mini Coder repo for agents:

- Specification is `mini-coder-spec.md` treat this spec as the source of truth.
- `docs/KNOWN_ISSUES.md` tracks known issues. `docs/mini-coder.1.md` is the man page.
- Create or reuse the `TODO.md` file to track your progress in long tasks. Remove completed items, keep it clean, concise, and up to date at all times. Track it in git.
- Write minimal tests, focused on our code's logic. Never test dependencies. Never use mocks or stubs.
- Keep the repo pristine: no failing tests, no lint, no build issues, no `ignore`-style comments. No failing hooks.
- Format then lint, in that order. This ensures the lint runs on formatted code and avoids unnecessary noise in lint reporting.
- We care about performance.
- Do not inline `import` calls. Don't duplicate code. Don't leave dead code behind.
- Don't re-implement helpers/functionality that already exists, always consolidate.
- Don't add complexity for backwards compatibility, it's preferable to break compatibility and keep the code simple.
- Don't make random test files, if you need to test something, write a proper unit test.
- If you make temp files, clean them up when you are done.
- Use Conventional Commits formatting for commit messages.
- Only use git commands when requested to do so by the user.
- When using Rezi, always follow the recommended patterns: https://rezitui.dev/docs/guide/recommended-patterns
