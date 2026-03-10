---
description: Create a new tagged npm release (patch/minor/major)
---

Create a new npm release for this repo. The bump type is: $1 (default to "patch" if not provided).

Steps to follow exactly:
1. Normalize bump type to one of `patch|minor|major`; if empty, use `patch`.
2. Verify git state before doing anything:
   - current branch must be `main`
   - working tree must be clean
   - run `git fetch origin --tags` and ensure `HEAD` equals `origin/main`
   If any check fails, stop and report.
3. Run `bun run typecheck && bun run format && bun run lint && bun test` — stop and report failures.
4. Read `package.json` and capture both `name` and current `version`.
5. Compute the next semver version by bumping the selected part.
6. Guardrails before mutating files:
   - ensure git tag `v<new-version>` does not exist locally or on origin
   - ensure npm version does not already exist: `npm view <package-name>@<new-version> version`
   If either exists, stop and report.
7. Update the `version` field in `package.json` to `<new-version>`.
8. Run `bun run build`.
9. Commit all staged and unstaged changes with message: `chore: release v<new-version>`.
10. Create annotated tag: `git tag -a v<new-version> -m "<new-version>"`.
11. Push explicitly to main and the exact tag:
    - `git push origin main`
    - `git push origin v<new-version>`
12. Post-push verification: run `npm view <package-name>@<new-version> version`.
    - If it already exists, report that publish already happened and do **not** ask user to publish again.
    - If it does not exist, ask user to run `npm publish` (passkey auth step).

