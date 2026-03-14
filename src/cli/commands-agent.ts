import * as c from "yoctocolors";
import { loadAgents } from "./agents.ts";
import { PREFIX, writeln } from "./output.ts";
import type { CommandContext } from "./types.ts";

export function handleAgentCommand(ctx: CommandContext, args: string): void {
	const raw = args.trim();
	const agents = loadAgents(ctx.cwd);

	if (!raw) {
		if (agents.size === 0) {
			writeln(
				c.dim("  no agents found  (~/.agents/agents/ or .agents/agents/)"),
			);
			writeln(
				c.dim("  /agent <name>  to activate  ·  /agent off  to deactivate"),
			);
			return;
		}
		writeln();
		writeln(c.dim("  agents:"));
		for (const agent of agents.values()) {
			const modeTag = agent.mode ? c.dim(` [${agent.mode}]`) : "";
			const srcTag =
				agent.source === "local" ? c.dim(" (local)") : c.dim(" (global)");
			const active = ctx.activeAgent === agent.name ? c.cyan(" ◀ active") : "";
			writeln(
				`  ${c.magenta(`@${agent.name}`.padEnd(26))} ${c.dim(agent.description)}${modeTag}${srcTag}${active}`,
			);
		}
		writeln();
		writeln(
			c.dim("  /agent <name>  to activate  ·  /agent off  to deactivate"),
		);
		writeln();
		return;
	}

	if (raw.toLowerCase() === "off" || raw.toLowerCase() === "none") {
		ctx.setActiveAgent(null);
		writeln(`${PREFIX.info} ${c.dim("active agent cleared")}`);
		return;
	}

	const agent = agents.get(raw);
	if (!agent) {
		writeln(`${PREFIX.error} agent ${c.cyan(raw)} not found`);
		return;
	}

	ctx.setActiveAgent(raw, agent.systemPrompt);
	writeln(
		`${PREFIX.success} active agent → ${c.cyan(raw)} ${c.dim("(instructions appended to system prompt)")}`,
	);
}
