import * as c from "yoctocolors";
import { fetchAvailableModels } from "../llm-api/providers.ts";
import type { SubagentOutput } from "../tools/subagent.ts";

import {
	deleteMcpServer,
	listMcpServers,
	upsertMcpServer,
} from "../session/db.ts";
import { loadAgents } from "./agents.ts";
import {
	type CustomCommand,
	expandTemplate,
	loadCustomCommands,
} from "./custom-commands.ts";
import { renderMarkdown } from "./markdown.ts";
import {
	PREFIX,
	renderError,
	renderInfo,
	renderSubagentActivity,
	write,
	writeln,
} from "./output.ts";
import { loadSkills } from "./skills.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommandContext {
	currentModel: string;
	setModel: (model: string) => void;
	planMode: boolean;
	setPlanMode: (enabled: boolean) => void;
	ralphMode: boolean;
	setRalphMode: (enabled: boolean) => void;
	undoLastTurn: () => Promise<boolean>;
	startNewSession: () => void;

	connectMcpServer: (name: string) => Promise<void>;
	runSubagent: (prompt: string, model?: string) => Promise<SubagentOutput>;

	cwd: string;
}

export type CommandResult =
	| { type: "handled" }
	| { type: "unknown"; command: string }
	| { type: "exit" }
	| { type: "inject-user-message"; text: string };

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleModel(ctx: CommandContext, args: string): Promise<void> {
	if (args) {
		// If the user passed a bare model name (no provider prefix), resolve it
		// against the live model list so we get the full "provider/model-id" form.
		let modelId = args;
		if (!args.includes("/")) {
			const models = await fetchAvailableModels();
			const match = models.find(
				(m) => m.id.split("/").slice(1).join("/") === args || m.id === args,
			);
			if (match) {
				modelId = match.id;
			} else {
				writeln(
					`${PREFIX.error} unknown model ${c.cyan(args)}  ${c.dim("— run /models for the full list")}`,
				);
				return;
			}
		}
		ctx.setModel(modelId);
		writeln(`${PREFIX.success} model → ${c.cyan(modelId)}`);
		return;
	}

	writeln(`${c.dim("  fetching models…")}`);

	const models = await fetchAvailableModels();

	// Clear the "fetching" line
	process.stdout.write("\x1B[1A\r\x1B[2K");

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
			const cur = isCurrent ? c.cyan(" ◀") : "";
			writeln(`    ${c.dim("·")} ${m.displayName}${freeTag}${ctxTag}${cur}`);
			writeln(`      ${c.dim(m.id)}`);
		}
	}

	writeln();
	writeln(
		c.dim("  /model <id>  to switch  ·  e.g. /model zen/claude-sonnet-4-6"),
	);
}

function handlePlan(ctx: CommandContext): void {
	ctx.setPlanMode(!ctx.planMode);
	if (ctx.planMode) {
		if (ctx.ralphMode) ctx.setRalphMode(false);
		writeln(
			`${PREFIX.info} ${c.yellow("plan mode")} ${c.dim("— read-only tools + MCP, no writes or shell")}`,
		);
	} else {
		writeln(`${PREFIX.info} ${c.dim("plan mode off")}`);
	}
}

function handleRalph(ctx: CommandContext): void {
	ctx.setRalphMode(!ctx.ralphMode);
	if (ctx.ralphMode) {
		if (ctx.planMode) ctx.setPlanMode(false);
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
				writeln(c.red("  usage: /mcp add <name> http <url>"));
				writeln(c.red("         /mcp add <name> stdio <cmd> [args...]"));
				return;
			}
			if (transport === "http") {
				const url = rest[0];
				if (!url) {
					writeln(c.red("  usage: /mcp add <name> http <url>"));
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
					writeln(c.red("  usage: /mcp add <name> stdio <cmd> [args...]"));
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
					c.red(`  unknown transport: ${transport}  (use http or stdio)`),
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
				writeln(c.red("  usage: /mcp remove <name>"));
				return;
			}
			deleteMcpServer(name);
			writeln(`${PREFIX.success} mcp server ${c.cyan(name)} removed`);
			return;
		}

		default:
			writeln(c.red(`  unknown: /mcp ${sub}`));
			writeln(c.dim("  subcommands: list · add · remove"));
	}
}

// ─── Review ───────────────────────────────────────────────────────────────────

const REVIEW_PROMPT = (cwd: string, focus: string) => `\
You are a code reviewer. Review recent changes and provide actionable feedback.

Working directory: ${cwd}
${focus ? `Focus: ${focus}` : ""}

## What to review
- No args: \`git diff\` (unstaged) + \`git diff --cached\` (staged) + \`git status --short\` (untracked)
- Commit hash: \`git show <hash>\`
- Branch: \`git diff <branch>...HEAD\`
- PR number/URL: \`gh pr view\` + \`gh pr diff\`

## How to review
After getting the diff, read the full files changed — diffs alone miss context.
Check for AGENTS.md or CONVENTIONS.md for project conventions.

## What to flag (priority order)
1. **Bugs** — logic errors, missing edge cases, unhandled errors, race conditions, security issues. Be certain before flagging; investigate first.
2. **Structure** — wrong abstraction, established patterns ignored, excessive nesting.
3. **Performance** — only if obviously problematic (O(n²) on unbounded data, N+1, blocking hot paths).
4. **Style** — only clear violations of project conventions. Don't be a zealot.

Only review the changed code, not pre-existing code.

## Output
- Be direct and specific: quote code, cite file and line number.
- State the scenario/input that triggers a bug — severity depends on this.
- No flattery, no filler. Matter-of-fact tone.
- End with a short **Summary** of the most important items.
`;

async function handleReview(
	ctx: CommandContext,
	args: string,
): Promise<CommandResult> {
	const focus = args.trim();
	writeln(
		`${PREFIX.info} ${c.cyan("review")} ${c.dim("— spawning review subagent…")}`,
	);
	writeln();

	try {
		const output = await ctx.runSubagent(REVIEW_PROMPT(ctx.cwd, focus));

		// Show subagent activity tree.
		if (output.activity.length) {
			renderSubagentActivity(output.activity, "  ", 1);
			writeln();
		}

		// Show review results.
		write(renderMarkdown(output.result));
		writeln();

		// Send results to LLM as well.
		return {
			type: "inject-user-message",
			text: `Code review output:\n\n${output.result}\n\n<system-message>Review the findings and summarize them to the user.</system-message>`,
		};
	} catch (e) {
		writeln(`${PREFIX.error} review failed: ${String(e)}`);
		return { type: "handled" };
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

	try {
		const output = await ctx.runSubagent(prompt, cmd.model);

		if (output.activity.length) {
			renderSubagentActivity(output.activity, "  ", 1);
			writeln();
		}

		write(renderMarkdown(output.result));
		writeln();

		return {
			type: "inject-user-message",
			text: `/${cmd.name} output:\n\n${output.result}\n\n<system-message>Summarize the findings above to the user.</system-message>`,
		};
	} catch (e) {
		writeln(`${PREFIX.error} /${cmd.name} failed: ${String(e)}`);
		return { type: "handled" };
	}
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
		["/plan", "toggle plan mode (read-only tools + MCP)"],
		[
			"/ralph",
			"toggle ralph mode (autonomous loop, fresh context each iteration)",
		],
		["/review [focus]", "run a structured code review on recent changes"],
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
			const tag =
				agent.source === "local" ? c.dim(" (local)") : c.dim(" (global)");
			writeln(
				`  ${c.magenta(`@${agent.name}`.padEnd(26))} ${c.dim(agent.description)}${tag}`,
			);
		}
	}

	// Show skills
	const skills = loadSkills(ctx.cwd);
	if (skills.size > 0) {
		writeln();
		writeln(c.dim("  skills  (~/.agents/skills/ or .agents/skills/):"));
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
		`  ${c.green("@skill".padEnd(26))} ${c.dim("inject skill instructions into prompt (Tab to complete)")}`,
	);
	writeln(
		`  ${c.green("@file".padEnd(26))} ${c.dim("inject file contents into prompt (Tab to complete)")}`,
	);
	writeln(
		`  ${c.green("!cmd".padEnd(26))} ${c.dim("run shell command, output added as context")}`,
	);
	writeln();
	writeln(
		`  ${c.dim("ctrl+c")}  cancel  ${c.dim("·")}  ${c.dim("ctrl+d")}  exit  ${c.dim("·")}  ${c.dim("ctrl+r")}  history search  ${c.dim("·")}  ${c.dim("↑↓")}  history`,
	);
	writeln();
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export async function handleCommand(
	command: string,
	args: string,
	ctx: CommandContext,
): Promise<CommandResult> {
	// Custom commands take precedence over built-ins — a local /review or
	// /plan in .agents/commands/ will shadow the built-in with that name.
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

		case "plan":
			handlePlan(ctx);
			return { type: "handled" };

		case "ralph":
			handleRalph(ctx);
			return { type: "handled" };

		case "mcp":
			await handleMcp(ctx, args);
			return { type: "handled" };

		case "new":
			handleNew(ctx);
			return { type: "handled" };

		case "review":
			return await handleReview(ctx, args);

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
