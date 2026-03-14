import * as c from "yoctocolors";
import { G, writeln } from "../output.ts";
import { renderDiff } from "../tool-result-shared.ts";

export function renderCreateResult(result: unknown): boolean {
	const r = result as { path: string; diff: string; created: boolean };
	if (!r || typeof r.path !== "string") return false;
	const verb = r.created ? c.green("created") : c.dim("overwritten");
	writeln(`    ${G.ok} ${verb} ${r.path}`);
	renderDiff(r.diff);
	return true;
}

export function renderReplaceOrInsertResult(
	toolName: string,
	result: unknown,
): boolean {
	const r = result as { path: string; diff: string; deleted?: boolean };
	if (!r || typeof r.path !== "string") return false;
	const verb =
		toolName === "insert" ? "inserted" : r.deleted ? "deleted" : "replaced";
	writeln(`    ${G.ok} ${c.dim(verb)} ${r.path}`);
	renderDiff(r.diff);
	return true;
}
