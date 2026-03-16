import * as c from "yoctocolors";
import { isAbortError } from "../agent/agent-helpers.ts";
import { handleAgentCommand } from "./commands-agent.ts";
import {
	handleCacheCommand,
	handleContextCommand,
	handleReasoningCommand,
	handleVerboseCommand,
} from "./commands-config.ts";
import { renderHelpCommand } from "./commands-help.ts";
import { handleLoginCommand, handleLogoutCommand } from "./commands-login.ts";
import { handleMcpCommand } from "./commands-mcp.ts";
import { handleModelCommand } from "./commands-model.ts";
import {
	type CustomCommand,
	expandTemplate,
	loadCustomCommands,
} from "./custom-commands.ts";
import { watchForCancel } from "./input.ts";
import { PREFIX, renderBanner, write, writeln } from "./output.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

import type { CommandContext } from "./types.ts";

type CommandResult =
	| { type: "handled" }
	| { type: "unknown"; command: string }
	| { type: "exit" }
	| { type: "inject-user-message"; text: string };

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleUndo(ctx: CommandContext): Promise<void> {
	ctx.startSpinner("removing last turn");
	try {
		const ok = await ctx.undoLastTurn();
		if (ok) {
			writeln(`${PREFIX.success} ${c.dim("last conversation turn removed")}`);
		} else {
			writeln(`${PREFIX.info} ${c.dim("nothing to undo")}`);
		}
	} finally {
		ctx.stopSpinner();
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
		write(output.result);
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

		case "verbose":
			handleVerboseCommand(ctx, args);
			return { type: "handled" };

		case "context":
			handleContextCommand(ctx, args);
			return { type: "handled" };
		case "cache":
			handleCacheCommand(ctx, args);
			return { type: "handled" };

		case "agent":
			handleAgentCommand(ctx, args);
			return { type: "handled" };

		case "mcp":
			await handleMcpCommand(ctx, args);
			return { type: "handled" };

		case "login":
			await handleLoginCommand(ctx, args);
			return { type: "handled" };

		case "logout":
			handleLogoutCommand(ctx, args);
			return { type: "handled" };

		case "new":
			handleNew(ctx);
			return { type: "handled" };

		case "help":
		case "?":
			renderHelpCommand(ctx, custom);
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
