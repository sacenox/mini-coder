import * as c from "yoctocolors";
import { isAbortError } from "../agent/agent-helpers.ts";
import {
	deleteMcpServer,
	listMcpServers,
	upsertMcpServer,
} from "../session/db/index.ts";
import { loadAgents } from "./agents.ts";
import {
	handleCacheCommand,
	handleContextCommand,
	handleReasoningCommand,
} from "./commands-config.ts";
import { handleModelCommand } from "./commands-model.ts";
import {
	type CustomCommand,
	expandTemplate,
	loadCustomCommands,
} from "./custom-commands.ts";
import { watchForCancel } from "./input.ts";
import { renderMarkdown } from "./markdown.ts";
import { PREFIX, renderBanner, write, writeln } from "./output.ts";

import { loadSkillsIndex } from "./skills.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

import type { CommandContext } from "./types.ts";

type CommandResult =
	| { type: "handled" }
	| { type: "unknown"; command: string }
	| { type: "exit" }
	| { type: "inject-user-message"; text: string };

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleUndo(ctx: CommandContext): Promise<void> {
	ctx.startSpinner("restoring snapshot");
	try {
		const ok = await ctx.undoLastTurn();
		if (ok) {
			writeln(
				`${PREFIX.success} ${c.dim("last turn undone — history and files restored")}`,
			);
		} else {
			writeln(`${PREFIX.info} ${c.dim("nothing to undo")}`);
		}
	} finally {
		ctx.stopSpinner();
	}
}

async function handleMcp(ctx: CommandContext, args: string): Promise<void> {
	const parts = args.trim().split(/\s+/);
	const sub = parts[0] ?? "list";

	switch (sub) {
		case "list": {
			const servers = listMcpServers();
			if (servers.length === 0) {
				writeln(c.dim("  no MCP servers configured"));
				writeln(
					c.dim(
						"  /mcp add <name> http <url>  ·  /mcp add <name> stdio <cmd> [args...]",
					),
				);
				return;
			}
			writeln();
			for (const s of servers) {
				const detail = s.url
					? c.dim(`  ${s.url}`)
					: s.command
						? c.dim(`  ${s.command}`)
						: "";
				writeln(
					`  ${c.yellow("⚙")} ${c.bold(s.name)}  ${c.dim(s.transport)}${detail}`,
				);
			}
			return;
		}

		case "add": {
			// http:  /mcp add <name> http <url>
			// stdio: /mcp add <name> stdio <cmd> [args...]
			const [, name, transport, ...rest] = parts;
			if (!name || !transport || rest.length === 0) {
				writeln(`${PREFIX.error} usage: /mcp add <name> http <url>`);
				writeln(`${PREFIX.error}        /mcp add <name> stdio <cmd> [args...]`);

				return;
			}
			if (transport === "http") {
				const url = rest[0];
				if (!url) {
					writeln(`${PREFIX.error} usage: /mcp add <name> http <url>`);

					return;
				}
				upsertMcpServer({
					name,
					transport,
					url,
					command: null,
					args: null,
					env: null,
				});
			} else if (transport === "stdio") {
				const [command, ...cmdArgs] = rest;
				if (!command) {
					writeln(
						`${PREFIX.error} usage: /mcp add <name> stdio <cmd> [args...]`,
					);

					return;
				}
				upsertMcpServer({
					name,
					transport,
					url: null,
					command,
					args: cmdArgs.length ? JSON.stringify(cmdArgs) : null,
					env: null,
				});
			} else {
				writeln(
					`${PREFIX.error} unknown transport: ${transport}  (use http or stdio)`,
				);

				return;
			}
			// Connect immediately so tools are available in this session
			try {
				await ctx.connectMcpServer(name);
				writeln(
					`${PREFIX.success} mcp server ${c.cyan(name)} added and connected`,
				);
			} catch (e) {
				writeln(
					`${PREFIX.success} mcp server ${c.cyan(name)} saved  ${c.dim(`(connection failed: ${String(e)})`)}`,
				);
			}
			return;
		}

		case "remove":
		case "rm": {
			const [, name] = parts;
			if (!name) {
				writeln(`${PREFIX.error} usage: /mcp remove <name>`);

				return;
			}
			deleteMcpServer(name);
			writeln(`${PREFIX.success} mcp server ${c.cyan(name)} removed`);
			return;
		}

		default:
			writeln(`${PREFIX.error} unknown: /mcp ${sub}`);

			writeln(c.dim("  subcommands: list · add · remove"));
	}
}

function handleNew(ctx: CommandContext): void {
	ctx.startNewSession();
	// Clear terminal and reprint banner for a fresh session feel
	process.stdout.write("\x1b[2J\x1b[H");
	renderBanner(ctx.currentModel, ctx.cwd);
}

// ─── Custom commands ──────────────────────────────────────────────────────────

async function handleCustomCommand(
	cmd: CustomCommand,
	args: string,
	ctx: CommandContext,
): Promise<CommandResult> {
	const prompt = await expandTemplate(cmd.template, args, ctx.cwd);
	const label = c.cyan(cmd.name);
	const srcPath =
		cmd.source === "local"
			? `.agents/commands/${cmd.name}.md`
			: `~/.agents/commands/${cmd.name}.md`;
	const src = c.dim(`[${srcPath}]`);
	writeln(`${PREFIX.info} ${label} ${src}`);
	writeln();

	// context: fork (Claude Code) or subtask: true (OpenCode) → isolated subagent.

	// Default: run inline in the current conversation.
	const fork = cmd.context === "fork" || cmd.subtask === true;

	if (!fork) {
		return { type: "inject-user-message", text: prompt };
	}

	const abortController = new AbortController();
	const stopWatcher = watchForCancel(abortController, {
		allowSubagentEsc: true,
	});
	try {
		ctx.startSpinner("subagent");
		const output = await ctx.runSubagent(
			prompt,
			cmd.agent,
			cmd.model,
			abortController.signal,
		);
		write(renderMarkdown(output.result));
		writeln();

		return {
			type: "inject-user-message",
			text: `/${cmd.name} output:\n\n${output.result}\n\n<system-message>Summarize the findings above to the user.</system-message>`,
		};
	} catch (e) {
		if (isAbortError(e as Error)) {
			return { type: "handled" };
		}
		writeln(`${PREFIX.error} /${cmd.name} failed: ${String(e)}`);
		return { type: "handled" };
	} finally {
		stopWatcher();
		ctx.stopSpinner();
	}
}

// ─── Agent ────────────────────────────────────────────────────────────────────

function handleAgent(ctx: CommandContext, args: string): void {
	const raw = args.trim();
	const agents = loadAgents(ctx.cwd);

	if (!raw) {
		// List all agents
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

	// Pass the resolved system prompt so setActiveAgent never needs to re-lookup.
	ctx.setActiveAgent(raw, agent.systemPrompt);
	writeln(
		`${PREFIX.success} active agent → ${c.cyan(raw)} ${c.dim("(instructions appended to system prompt)")}`,
	);
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function handleHelp(
	ctx: CommandContext,
	custom: Map<string, CustomCommand>,
): void {
	writeln();

	const cmds: [string, string][] = [
		["/model [id]", "list or switch models (fetches live list)"],
		["/undo", "remove the last turn from conversation history"],
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

	// Show custom commands
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

	// Show agents
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

	// Show skills
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

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export async function handleCommand(
	command: string,
	args: string,
	ctx: CommandContext,
): Promise<CommandResult> {
	// Custom commands take precedence over built-ins.
	const custom = loadCustomCommands(ctx.cwd);
	const customCmd = custom.get(command.toLowerCase());
	if (customCmd) {
		return await handleCustomCommand(customCmd, args, ctx);
	}

	switch (command.toLowerCase()) {
		case "model":
		case "models":
			await handleModelCommand(ctx, args);
			return { type: "handled" };

		case "undo":
			await handleUndo(ctx);
			return { type: "handled" };

		case "reasoning":
			handleReasoningCommand(ctx, args);
			return { type: "handled" };

		case "context":
			handleContextCommand(ctx, args);
			return { type: "handled" };
		case "cache":
			handleCacheCommand(ctx, args);
			return { type: "handled" };

		case "agent":
			handleAgent(ctx, args);
			return { type: "handled" };

		case "mcp":
			await handleMcp(ctx, args);
			return { type: "handled" };

		case "new":
			handleNew(ctx);
			return { type: "handled" };

		case "help":
		case "?":
			handleHelp(ctx, custom);
			return { type: "handled" };

		case "exit":
		case "quit":
		case "q":
			return { type: "exit" };

		default: {
			writeln(
				`${PREFIX.error} unknown: /${command}  ${c.dim("— /help for commands")}`,
			);
			return { type: "unknown", command };
		}
	}
}
