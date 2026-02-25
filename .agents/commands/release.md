---
description: Create a new tagged npm release (patch/minor/major)
---

Create a new npm release for this repo. The bump type is: $1 (default to "patch" if not provided).

Steps to follow exactly:
1. Run `bun run typecheck && bun run format && bun run lint && bun test` — stop and report any failures before proceeding.
2. Read `package.json` and determine the current version.
3. Compute the next version by bumping the $1 part of the semver (patch/minor/major). Default to "patch" if $1 is empty.
4. Update the `version` field in `package.json` to the new version.
5. Run `bun run build` to produce a fresh `dist/mc.js`.
6. Commit all staged and unstaged changes with the message: `chore: release v<new-version>`.
7. Create a git tag `v<new-version>` on that commit.
8. Push the commit and the tag: `git push && git push --tags`.
9. Ask the user to run `npm publish` to publish to npm to complete the push with passkey auth.
