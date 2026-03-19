import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as c from "yoctocolors";
import { writeln } from "./output.ts";

const REVIEW_SKILL_CONTENT = `---
name: review
description: Review recent changes for correctness, code quality, and performance
context: fork
---
You are a code reviewer. Review recent changes and provide actionable feedback.

Perform a sensible code review:
- Correctness: Are the changes in alignment with the goal?
- Code quality: Is there duplicate, dead, or bad code patterns introduced?
- Is the code performant?
- Never flag style choices as bugs, don't be a zealot.
- Never flag false positives, check before raising an issue.

Output a small summary with only the issues found. If nothing is wrong, say so.
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
