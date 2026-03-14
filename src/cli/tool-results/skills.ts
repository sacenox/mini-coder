import * as c from "yoctocolors";
import { G, writeln } from "../output.ts";

export function renderReadSkillResult(result: unknown): boolean {
	const r = result as {
		skill?: {
			name?: string;
			description?: string;
			source?: "local" | "global";
		};
	};
	if (!r || typeof r !== "object") return false;
	if (!r.skill) {
		writeln(`    ${G.info} ${c.dim("skill")}  ${c.dim("(not found)")}`);
		return true;
	}
	const name = r.skill.name ?? "(unknown)";
	const source = r.skill.source ?? "unknown";
	const description = r.skill.description?.trim();
	const descPart = description
		? `  ${c.dim("·")}  ${c.dim(description.length > 60 ? `${description.slice(0, 57)}…` : description)}`
		: "";
	writeln(
		`    ${G.info} ${c.dim("skill")}  ${name}  ${c.dim("·")}  ${c.dim(source)}${descPart}`,
	);
	return true;
}
