import * as c from "yoctocolors";
import { isAbortError } from "../agent/agent-helpers.ts";
import type { ThinkingEffort } from "../llm-api/providers.ts";
import { fetchAvailableModels } from "../llm-api/providers.ts";
import {
	deleteMcpServer,
	listMcpServers,
	upsertMcpServer,
} from "../session/db/index.ts";
import { loadAgents } from "./agents.ts";
import {
	type CustomCommand,
	expandTemplate,
	loadCustomCommands,
} from "./custom-commands.ts";
import { watchForCancel } from "./input.ts";
import { renderMarkdown } from "./markdown.ts";
import { PREFIX, write, writeln } from "./output.ts";

import { loadSkillsIndex } from "./skills.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

import type { CommandContext } from "./types.ts";

type CommandResult =
	| { type: "handled" }
	| { type: "unknown"; command: string }
	| { type: "exit" }
	| { type: "inject-user-message"; text: string };

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleModel(ctx: CommandContext, args: string): Promise<void> {
	const parts = args.trim().split(/\s+/).filter(Boolean);

	if (parts.length > 0) {
		if (parts[0] === "effort") {
			const effortArg = parts[1] ?? "";
			if (effortArg === "off") {
				ctx.setThinkingEffort(null);
				writeln(`${PREFIX.success} thinking effort disabled`);
			} else if (["low", "medium", "high", "xhigh"].includes(effortArg)) {
				ctx.setThinkingEffort(effortArg as ThinkingEffort);
				writeln(`${PREFIX.success} thinking effort → ${c.cyan(effortArg)}`);
			} else {
				writeln(
					`${PREFIX.error} usage: /model effort <low|medium|high|xhigh|off>`,
				);
			}
			return;
		}

		// Otherwise, it's a model switch
		const idArg = parts[0] ?? "";
		let modelId = idArg;
		if (!idArg.includes("/")) {
			const snapshot = await fetchAvailableModels();
			const match = snapshot.models.find(
				(m) => m.id.split("/").slice(1).join("/") === idArg || m.id === idArg,
			);
			if (match) {
				modelId = match.id;
			} else {
				writeln(
					`${PREFIX.error} unknown model ${c.cyan(idArg)}  ${c.dim("— run /models for the full list")}`,
				);
				return;
			}
		}
		ctx.setModel(modelId);

		const effortArg = parts[1];
		if (effortArg) {
			if (effortArg === "off") {
				ctx.setThinkingEffort(null);
				writeln(
					`${PREFIX.success} model → ${c.cyan(modelId)} ${c.dim("(thinking disabled)")}`,
				);
			} else if (["low", "medium", "high", "xhigh"].includes(effortArg)) {
				ctx.setThinkingEffort(effortArg as ThinkingEffort);
				writeln(
					`${PREFIX.success} model → ${c.cyan(modelId)} ${c.dim(`(✦ ${effortArg})`)}`,
				);
			} else {
				writeln(`${PREFIX.success} model → ${c.cyan(modelId)}`);
				writeln(
					`${PREFIX.error} unknown effort level ${c.cyan(effortArg)} (use low, medium, high, xhigh, off)`,
				);
			}
		} else {
			const e = ctx.thinkingEffort ? c.dim(` (✦ ${ctx.thinkingEffort})`) : "";
			writeln(`${PREFIX.success} model → ${c.cyan(modelId)}${e}`);
		}
		return;
	}

	ctx.startSpinner("fetching models");

	const snapshot = await fetchAvailableModels();
	const models = snapshot.models;

	ctx.stopSpinner();

	if (models.length === 0) {
		writeln(
			`${PREFIX.error} No models found. Check your API keys or Ollama connection.`,
		);
		writeln(
			c.dim(
				"  Set OPENCODE_API_KEY for Zen, or start Ollama for local models.",
			),
		);
		return;
	}

	if (snapshot.stale) {
		const lastSync = snapshot.lastSyncAt
			? new Date(snapshot.lastSyncAt).toLocaleString()
			: "never";
		const refreshTag = snapshot.refreshing ? " (refreshing in background)" : "";
		writeln(
			c.dim(`  model metadata is stale (last sync: ${lastSync})${refreshTag}`),
		);
	}

	// Group by provider
	const byProvider = new Map<string, typeof models>();
	for (const m of models) {
		const existing = byProvider.get(m.provider);
		if (existing) {
			existing.push(m);
		} else {
			byProvider.set(m.provider, [m]);
		}
	}

	writeln();
	for (const [provider, list] of byProvider) {
		writeln(c.bold(`  ${provider}`));
		for (const m of list) {
			const isCurrent = ctx.currentModel === m.id;
			const freeTag = m.free ? c.green(" free") : "";
			const ctxTag = m.context
				? c.dim(` ${Math.round(m.context / 1000)}k`)
				: "";
			const effortTag =
				isCurrent && ctx.thinkingEffort
					? c.dim(` ✦ ${ctx.thinkingEffort}`)
					: "";
			const cur = isCurrent ? c.cyan(" ◀") : "";
			writeln(
				`    ${c.dim("·")} ${m.displayName}${freeTag}${ctxTag}${cur}${effortTag}`,
			);
			writeln(`      ${c.dim(m.id)}`);
		}
	}

	writeln();
	writeln(
		c.dim("  /model <id>  to switch  ·  e.g. /model zen/claude-sonnet-4-6"),
	);
	writeln(
		c.dim(
			"  /model effort <low|medium|high|xhigh|off>  to set thinking effort",
		),
	);
}

function handleReasoning(ctx: CommandContext, args: string): void {
	const mode = args.trim().toLowerCase();
	if (!mode) {
		ctx.setShowReasoning(!ctx.showReasoning);
		writeln(
			`${PREFIX.success} reasoning display ${ctx.showReasoning ? c.green("on") : c.dim("off")}`,
		);
		return;
	}
	if (mode === "on") {
		ctx.setShowReasoning(true);
		writeln(`${PREFIX.success} reasoning display ${c.green("on")}`);
		return;
	}
	if (mode === "off") {
		ctx.setShowReasoning(false);
		writeln(`${PREFIX.success} reasoning display ${c.dim("off")}`);
		return;
	}
	writeln(`${PREFIX.error} usage: /reasoning <on|off>`);
}

function handleContext(ctx: CommandContext, args: string): void {
	const [sub, value] = args.trim().split(/\s+/, 2);
	if (!sub) {
		const capText =
			ctx.toolResultPayloadCapBytes <= 0
				? "off"
				: `${Math.round(ctx.toolResultPayloadCapBytes / 1024)}KB (${ctx.toolResultPayloadCapBytes} bytes)`;
		writeln(
			`${PREFIX.info} pruning=${c.cyan(ctx.pruningMode)}  tool-result-cap=${c.cyan(capText)}`,
		);
		writeln(c.dim("  usage: /context prune <off|balanced|aggressive>"));
		writeln(c.dim("         /context cap <off|bytes|kb>"));
		return;
	}

	if (sub === "prune") {
		if (value === "off" || value === "balanced" || value === "aggressive") {
			ctx.setPruningMode(value);
			writeln(`${PREFIX.success} context pruning → ${c.cyan(value)}`);
			return;
		}
		writeln(`${PREFIX.error} usage: /context prune <off|balanced|aggressive>`);
		return;
	}

	if (sub === "cap") {
		if (!value) {
			writeln(`${PREFIX.error} usage: /context cap <off|bytes|kb>`);
			return;
		}
		if (value === "off") {
			ctx.setToolResultPayloadCapBytes(0);
			writeln(`${PREFIX.success} tool-result payload cap disabled`);
			return;
		}
		const capMatch = value.match(/^(\d+)(kb)?$/i);
		if (!capMatch) {
			writeln(`${PREFIX.error} invalid cap: ${c.cyan(value)}`);
			return;
		}
		const base = Number.parseInt(capMatch[1] ?? "", 10);
		const capBytes =
			(capMatch[2] ?? "").toLowerCase() === "kb" ? base * 1024 : base;
		if (!Number.isFinite(capBytes) || capBytes < 0) {
			writeln(`${PREFIX.error} invalid cap: ${c.cyan(value)}`);
			return;
		}
		ctx.setToolResultPayloadCapBytes(capBytes);
		writeln(
			`${PREFIX.success} tool-result payload cap → ${c.cyan(`${capBytes} bytes`)}`,
		);
		return;
	}

	writeln(`${PREFIX.error} usage: /context <prune|cap> ...`);
}
function handleCache(ctx: CommandContext, args: string): void {
	const [sub, value] = args.trim().split(/\s+/, 2);

	if (!sub) {
		const gCache = ctx.googleCachedContent
			? c.cyan(ctx.googleCachedContent)
			: "off";
		writeln(
			`${PREFIX.info} prompt-caching=${ctx.promptCachingEnabled ? c.green("on") : c.dim("off")}  openai-retention=${c.cyan(ctx.openaiPromptCacheRetention)}  gemini-cache=${gCache}`,
		);
		writeln(c.dim("  usage: /cache <on|off>"));
		writeln(c.dim("         /cache openai <in_memory|24h>"));
		writeln(c.dim("         /cache gemini <off|cachedContents/...>"));
		return;
	}

	if (sub === "on" || sub === "off") {
		ctx.setPromptCachingEnabled(sub === "on");
		writeln(
			`${PREFIX.success} prompt caching → ${sub === "on" ? c.green("on") : c.dim("off")}`,
		);
		return;
	}

	if (sub === "openai") {
		if (value === "in_memory" || value === "24h") {
			ctx.setOpenAIPromptCacheRetention(value);
			writeln(
				`${PREFIX.success} openai prompt cache retention → ${c.cyan(value)}`,
			);
			return;
		}
		writeln(`${PREFIX.error} usage: /cache openai <in_memory|24h>`);
		return;
	}

	if (sub === "gemini") {
		if (!value) {
			writeln(`${PREFIX.error} usage: /cache gemini <off|cachedContents/...>`);
			return;
		}
		if (value === "off") {
			ctx.setGoogleCachedContent(null);
			writeln(`${PREFIX.success} gemini cached content → ${c.dim("off")}`);
			return;
		}
		ctx.setGoogleCachedContent(value);
		writeln(`${PREFIX.success} gemini cached content → ${c.cyan(value)}`);
		return;
	}

	writeln(`${PREFIX.error} usage: /cache <on|off|openai|gemini> ...`);
}

function handleRalph(ctx: CommandContext): void {
	ctx.setRalphMode(!ctx.ralphMode);
	if (ctx.ralphMode) {
		writeln(
			`${PREFIX.info} ${c.magenta("ralph mode")} ${c.dim("— loops until done, fresh context each iteration")}`,
		);
	} else {
		writeln(`${PREFIX.info} ${c.dim("ralph mode off")}`);
	}
}

async function handleUndo(ctx: CommandContext): Promise<void> {
	const ok = await ctx.undoLastTurn();
	if (ok) {
		writeln(
			`${PREFIX.success} ${c.dim("last turn undone — history and files restored")}`,
		);
	} else {
		writeln(`${PREFIX.info} ${c.dim("nothing to undo")}`);
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
	writeln(
		`${PREFIX.success} ${c.dim("new session started — context cleared")}`,
	);
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
			"/ralph",
			"toggle ralph mode (autonomous loop, fresh context each iteration)",
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
				`  ${c.magenta(`@${agent.name}`.padEnd(26))} ${c.dim(agent.description)}${modeTag}${tag}`,
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
		`  ${c.green("@agent".padEnd(26))} ${c.dim("run prompt through a custom agent (Tab to complete)")}`,
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
			await handleModel(ctx, args);
			return { type: "handled" };

		case "undo":
			await handleUndo(ctx);
			return { type: "handled" };

		case "reasoning":
			handleReasoning(ctx, args);
			return { type: "handled" };

		case "context":
			handleContext(ctx, args);
			return { type: "handled" };
		case "cache":
			handleCache(ctx, args);
			return { type: "handled" };

		case "ralph":
			handleRalph(ctx);
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
