import * as c from "yoctocolors";
import { G, writeln } from "./output.ts";

export function warnConventionConflicts(
	kind: "commands" | "skills",
	scope: "global" | "local",
	agentsNames: Iterable<string>,
	claudeNames: Iterable<string>,
): void {
	const agents = new Set(agentsNames);
	const claude = new Set(claudeNames);
	const conflicts: string[] = [];

	for (const name of agents) {
		if (claude.has(name)) conflicts.push(name);
	}

	if (conflicts.length === 0) return;

	conflicts.sort((a, b) => a.localeCompare(b));
	const list = conflicts.map((n) => c.cyan(n)).join(c.dim(", "));
	writeln(
		`${G.warn} conflicting ${kind} in ${scope} .agents and .claude: ${list} ${c.dim("— using .agents version")}`,
	);
}
