import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as c from "yoctocolors";
import { writeln } from "./output.ts";

const REVIEW_SKILL_CONTENT = `---
name: review
description: "Review recent changes for correctness, code quality, and performance. Use when the user asks to review, check, or audit recent code changes, diffs, or pull requests."
context: fork
---

Review recent changes and provide actionable feedback.

## Steps

1. Identify the changes to review — check \`git diff\`, \`git log\`, and staged files.
2. Read the changed files and understand the intent behind each change.
3. Evaluate each change against the criteria below.
4. Output a concise summary with only the issues found. If nothing is wrong, say so.

## Review criteria

- **Correctness** — Are the changes aligned with their stated goal? Do they introduce bugs or regressions?
- **Code quality** — Is there duplicate, dead, or overly complex code? Are abstractions appropriate?
- **Performance** — Are there unnecessary allocations, redundant I/O, or algorithmic concerns?
- **Edge cases** — Are boundary conditions and error paths handled?

## Guidelines

- Never flag style choices as bugs — don't be a zealot.
- Never flag false positives — verify before raising an issue.
- Keep feedback actionable: say what's wrong and suggest a fix.
`;

export function bootstrapGlobalDefaults(): void {
  const skillDir = join(homedir(), ".agents", "skills", "review");
  const skillPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillPath)) {
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillPath, REVIEW_SKILL_CONTENT, "utf-8");
    writeln(
      `${c.green("✓")} created ${c.dim("~/.agents/skills/review/SKILL.md")} ${c.dim("(edit it to customise your reviews)")}`,
    );
  }
}
