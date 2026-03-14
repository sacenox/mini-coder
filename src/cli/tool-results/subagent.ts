import * as c from "yoctocolors";
import { G, writeln } from "../output.ts";

export function renderSubagentResult(result: unknown): boolean {
	const r = result as {
		inputTokens?: number;
		outputTokens?: number;
		agentName?: string;
	};
	if (!r || typeof r !== "object") return false;
	const label = r.agentName ? ` ${c.dim(c.cyan(`[@${r.agentName}]`))}` : "";
	writeln(
		`    ${G.agent}${label} ${c.dim(`subagent done (${r.inputTokens ?? 0}in / ${r.outputTokens ?? 0}out tokens)`)}`,
	);
	return true;
}
