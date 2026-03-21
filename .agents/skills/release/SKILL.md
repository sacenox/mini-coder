---
name: release
description: "Create a new tagged npm release (patch/minor/major). Use when the user asks to release, publish, bump version, or cut a new version. Triggers on: release, publish, bump, version, tag."
compatibility: "Requires git, bun, and npm with publish credentials"
---

Create a new npm release for this repo. The bump type is: $1 (default to "patch" if not provided).

## Steps

1. **Normalize** the bump type to one of `patch | minor | major`. Default to `patch` if empty.
2. **Verify git state** before mutating anything:
   - Current branch must be `main`.
   - Working tree must be clean (`git status --porcelain` is empty).
   - Run `git fetch origin --tags` and ensure `HEAD` equals `origin/main`.
   - If any check fails, stop and report.
3. **Run checks** — execute the full repo check suite. Stop and report on failures.
4. **Read `package.json`** and capture `name` and current `version`.
5. **Compute next version** by bumping the selected semver part.
6. **Guardrails** before mutating files:
   - Ensure git tag `v<new-version>` does not exist locally or on origin.
   - Ensure npm version does not already exist: `npm view <name>@<new-version> version`.
   - If either exists, stop and report.
7. **Update `package.json`** — set the `version` field to `<new-version>`.
8. **Build** — run `bun run build`.
9. **Commit** all staged and unstaged changes: `chore: release v<new-version>`.
10. **Tag** — create annotated tag: `git tag -a v<new-version> -m "<small changelog>"`.
11. **Push** explicitly to main and the exact tag:
    - `git push origin main`
    - `git push origin v<new-version>`
12. **Post-push verification** — run `npm view <name>@<new-version> version`.
    - If it already exists, report that publish already happened — do **not** ask to publish again.
    - If it does not exist, run `npm publish`.

## Edge cases

- If the build fails, revert the version bump in `package.json` and stop.
- If the push fails, do not retry — report the failure and let the user resolve.
