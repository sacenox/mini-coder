import * as c from "yoctocolors";
import { loadAgents } from "./agents.ts";
import type { CustomCommand } from "./custom-commands.ts";
import { writeln } from "./output.ts";
import { loadSkillsIndex } from "./skills.ts";
import type { CommandContext } from "./types.ts";

function renderEntries(
	entries: ReadonlyArray<readonly [string, string]>,
): void {
	for (const [label, description] of entries) {
		writeln(`  ${c.cyan(label.padEnd(28))} ${c.dim(description)}`);
	}
}

export function renderHelpCommand(
	ctx: CommandContext,
	custom: Map<string, CustomCommand>,
): void {
	writeln();
	writeln(`  ${c.dim("session")}`);
	renderEntries([
		["/new", "start a fresh session"],
		["/undo", "remove the last conversation turn"],
		["/exit", "quit"],
	]);

	writeln();
	writeln(`  ${c.dim("model + context")}`);
	renderEntries([
		["/model [id]", "list or switch models"],
		["/reasoning [on|off]", "toggle reasoning display"],
		["/verbose [on|off]", "toggle output truncation"],
		["/context [prune|cap]", "configure pruning and tool-result caps"],
		["/agent [name]", "set or clear the active agent"],
		["/mcp list", "list MCP servers"],
		["/mcp add <n> <t> [u]", "add an MCP server"],
		["/mcp remove <name>", "remove an MCP server"],
		["/login [provider]", "login via OAuth (e.g. anthropic)"],
		["/logout <provider>", "clear OAuth tokens"],
		["/help", "show this help"],
	]);

	writeln();
	writeln(`  ${c.dim("prompt")}`);
	renderEntries([
		["ask normally", "send a prompt to the current agent"],
		["!cmd", "run a shell command and keep the result in context"],
		["@file", "inject a file into the prompt (Tab to complete)"],
		["@skill", "inject a skill into the prompt (Tab to complete)"],
	]);

	if (custom.size > 0) {
		writeln();
		writeln(`  ${c.dim("custom commands")}`);
		for (const cmd of custom.values()) {
			const source = cmd.source === "local" ? c.dim("local") : c.dim("global");
			writeln(
				`  ${c.green(`/${cmd.name}`.padEnd(28))} ${c.dim(cmd.description)} ${c.dim("·")} ${source}`,
			);
		}
	}

	const agents = loadAgents(ctx.cwd);
	if (agents.size > 0) {
		writeln();
		writeln(`  ${c.dim("agents")}`);
		for (const agent of agents.values()) {
			const source =
				agent.source === "local" ? c.dim("local") : c.dim("global");
			writeln(
				`  ${c.magenta(agent.name.padEnd(28))} ${c.dim(agent.description)} ${c.dim("·")} ${source}`,
			);
		}
	}

	const skills = loadSkillsIndex(ctx.cwd);
	if (skills.size > 0) {
		writeln();
		writeln(`  ${c.dim("skills")}`);
		for (const skill of skills.values()) {
			const source =
				skill.source === "local" ? c.dim("local") : c.dim("global");
			writeln(
				`  ${c.yellow(`@${skill.name}`.padEnd(28))} ${c.dim(skill.description)} ${c.dim("·")} ${source}`,
			);
		}
	}

	writeln();
	writeln(
		`  ${c.dim("keys")}  ${c.dim("esc")} cancel response  ${c.dim("·")}  ${c.dim("ctrl+c / ctrl+d")} exit  ${c.dim("·")}  ${c.dim("ctrl+r")} history search  ${c.dim("·")}  ${c.dim("↑↓")} history`,
	);
	writeln();
}
