import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as c from "yoctocolors";
import { writeln } from "./output.ts";

const REVIEW_COMMAND_CONTENT = `---
description: Review recent changes for correctness, code quality, and performance
---
You are a code reviewer. Review recent changes and provide actionable feedback.

$ARGUMENTS

Perform a sensible code review:
- Correctness: Are the changes in alignment with the goal?
- Code quality: Is there duplicate, dead, or bad code patterns introduced?
- Is the code performant?
- Never flag style choices as bugs, don't be a zealot.
- Never flag false positives, check before raising an issue.

Output a small summary with only the issues found. If nothing is wrong, say so.
`;

export function bootstrapGlobalDefaults(): void {
	const commandsDir = join(homedir(), ".agents", "commands");
	const reviewPath = join(commandsDir, "review.md");
	if (!existsSync(reviewPath)) {
		mkdirSync(commandsDir, { recursive: true });
		writeFileSync(reviewPath, REVIEW_COMMAND_CONTENT, "utf-8");
		writeln(
			`${c.green("✓")} created ${c.dim("~/.agents/commands/review.md")} ${c.dim("(edit it to customise your reviews)")}`,
		);
	}
}
