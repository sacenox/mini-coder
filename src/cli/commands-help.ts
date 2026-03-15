import * as c from "yoctocolors";
import { loadAgents } from "./agents.ts";
import type { CustomCommand } from "./custom-commands.ts";
import { writeln } from "./output.ts";
import { loadSkillsIndex } from "./skills.ts";
import type { CommandContext } from "./types.ts";

export function renderHelpCommand(
	ctx: CommandContext,
	custom: Map<string, CustomCommand>,
): void {
	writeln();

	const cmds: [string, string][] = [
		["/model [id]", "list or switch models (fetches live list)"],
		["/undo", "remove the last conversation turn"],
		["/reasoning [on|off]", "toggle display of model reasoning output"],
		["/context [prune|cap]", "configure context pruning and tool-result caps"],
		[
			"/cache [on|off|openai|gemini]",
			"configure provider prompt-caching settings",
		],
		["/agent [name]", "set or clear active primary agent"],
		["/mcp list", "list MCP servers"],
		["/mcp add <n> <t> [u]", "add an MCP server"],
		["/mcp remove <name>", "remove an MCP server"],
		["/new", "start a new session with clean context"],
		["/help", "this message"],
		["/exit", "quit"],
	];
	for (const [cmd, desc] of cmds) {
		writeln(`  ${c.cyan(cmd.padEnd(26))} ${c.dim(desc)}`);
	}

	if (custom.size > 0) {
		writeln();
		writeln(c.dim("  custom commands:"));
		for (const cmd of custom.values()) {
			const tag =
				cmd.source === "local" ? c.dim(" (local)") : c.dim(" (global)");
			writeln(
				`  ${c.green(`/${cmd.name}`.padEnd(26))} ${c.dim(cmd.description)}${tag}`,
			);
		}
	}

	const agents = loadAgents(ctx.cwd);
	if (agents.size > 0) {
		writeln();
		writeln(c.dim("  agents  (~/.agents/agents/ or .agents/agents/):"));
		for (const agent of agents.values()) {
			const modeTag = agent.mode ? c.dim(` [${agent.mode}]`) : "";
			const tag =
				agent.source === "local" ? c.dim(" (local)") : c.dim(" (global)");
			writeln(
				`  ${c.magenta(agent.name.padEnd(26))} ${c.dim(agent.description)}${modeTag}${tag}`,
			);
		}
	}

	const skills = loadSkillsIndex(ctx.cwd);
	if (skills.size > 0) {
		writeln();
		writeln(
			c.dim(
				"  skills  (walk-up local .agents/.claude/skills + global ~/.agents/skills ~/.claude/skills):",
			),
		);
		for (const skill of skills.values()) {
			const tag =
				skill.source === "local" ? c.dim(" (local)") : c.dim(" (global)");
			writeln(
				`  ${c.yellow(`@${skill.name}`.padEnd(26))} ${c.dim(skill.description)}${tag}`,
			);
		}
	}

	writeln();
	writeln(
		`  ${c.green("/agent <name>".padEnd(26))} ${c.dim("activate a custom agent by name")}`,
	);
	writeln(
		`  ${c.green("@skill".padEnd(26))} ${c.dim("load a skill body on demand into the prompt (Tab to complete)")}`,
	);
	writeln(
		`  ${c.green("@file".padEnd(26))} ${c.dim("inject file contents into prompt (Tab to complete)")}`,
	);
	writeln(
		`  ${c.green("!cmd".padEnd(26))} ${c.dim("run shell command, output added as context")}`,
	);
	writeln();
	writeln(
		`  ${c.dim("esc")}  cancel response  ${c.dim("·")}  ${c.dim("ctrl+c")}  exit  ${c.dim("·")}  ${c.dim("ctrl+d")}  exit  ${c.dim("·")}  ${c.dim("ctrl+r")}  history search  ${c.dim("·")}  ${c.dim("↑↓")}  history`,
	);
	writeln();
}
