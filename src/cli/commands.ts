import * as c from "yoctocolors";
import {
	availableProviders,
	fetchAvailableModels,
} from "../llm-api/providers.ts";
import {
	deleteMcpServer,
	listMcpServers,
	upsertMcpServer,
} from "../session/db.ts";
import { PREFIX, renderError, renderInfo, writeln } from "./output.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommandContext {
	currentModel: string;
	setModel: (model: string) => void;
	planMode: boolean;
	setPlanMode: (enabled: boolean) => void;
	undoLastTurn: () => boolean;
	connectMcpServer: (name: string) => Promise<void>;
	runSubagent: (
		prompt: string,
		model?: string,
	) => Promise<{ result: string; inputTokens: number; outputTokens: number }>;
	cwd: string;
}

export type CommandResult =
	| { type: "handled" }
	| { type: "unknown"; command: string }
	| { type: "exit" };

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
		writeln(
			`${PREFIX.info} ${c.yellow("plan mode")} ${c.dim("— agent will describe without running tools")}`,
		);
	} else {
		writeln(`${PREFIX.info} ${c.dim("plan mode off")}`);
	}
}

function handleUndo(ctx: CommandContext): void {
	const ok = ctx.undoLastTurn();
	if (ok) {
		writeln(`${PREFIX.success} ${c.dim("last turn removed from history")}`);
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
You are a thorough code reviewer. Your job is to review the recent changes in \
this codebase and produce a structured, actionable report.

Working directory: ${cwd}
${focus ? `Focus area: ${focus}` : ""}

Use the following hierarchy of concerns (most important first) to guide your review:

1. **Comprehension & team alignment** — Is the intent of the change clear? \
Would a teammate be able to understand the system after reading this? \
Flag anything that lacks explanation or diverges from established patterns without reason.

2. **Correctness** — Does the change actually solve the stated problem? \
Look for logic errors, missing edge cases, incorrect assumptions, and off-by-one errors.

3. **Design** — Is the approach well-structured? \
Consider separation of concerns, abstraction quality, coupling, cohesion, \
and whether a simpler design could achieve the same goal.

4. **Bugs & safety** — Identify potential runtime errors, unhandled rejections/exceptions, \
type unsafety, resource leaks, race conditions, or security issues.

5. **Style & consistency** — Flag naming inconsistencies, formatting issues, \
dead code, missing or misleading comments — only after the above are addressed.

Instructions:
- First use \`shell\` to run \`git diff HEAD~1\` (or \`git diff --cached\` if there are staged changes) \
to see what changed. Also run \`git log --oneline -5\` for context.
- Use \`glob\`, \`grep\`, and \`read\` as needed to understand the full context of changed files.
- Structure your output with a section per concern level above. \
Use "✔ nothing to flag" for levels with no issues.
- End with a short **Summary** of the most important items to address.
- Be specific: quote code, cite file names and line numbers.
- Be direct but constructive. Focus on the code, not the author.
`;

async function handleReview(ctx: CommandContext, args: string): Promise<void> {
	const focus = args.trim();
	writeln(
		`${PREFIX.info} ${c.cyan("review")} ${c.dim("— spawning review subagent…")}`,
	);
	writeln();

	try {
		const { result } = await ctx.runSubagent(REVIEW_PROMPT(ctx.cwd, focus));

		// Stream the result line-by-line for readable output
		for (const line of result.split("\n")) {
			writeln(`  ${line}`);
		}
		writeln();
	} catch (e) {
		writeln(`${PREFIX.error} review failed: ${String(e)}`);
	}
}

function handleHelp(): void {
	writeln();
	const cmds: [string, string][] = [
		["/model [id]", "list or switch models (fetches live list)"],
		["/undo", "remove the last turn from conversation history"],
		["/plan", "toggle plan mode (no tool execution)"],
		["/review [focus]", "run a structured code review on recent changes"],
		["/mcp list", "list MCP servers"],
		["/mcp add <n> <t> [u]", "add an MCP server"],
		["/mcp remove <name>", "remove an MCP server"],
		["/help", "this message"],
		["/exit", "quit"],
	];
	for (const [cmd, desc] of cmds) {
		writeln(`  ${c.cyan(cmd.padEnd(26))} ${c.dim(desc)}`);
	}
	writeln();
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
	switch (command.toLowerCase()) {
		case "model":
		case "models":
			await handleModel(ctx, args);
			return { type: "handled" };

		case "undo":
			handleUndo(ctx);
			return { type: "handled" };

		case "plan":
			handlePlan(ctx);
			return { type: "handled" };

		case "mcp":
			await handleMcp(ctx, args);
			return { type: "handled" };

		case "review":
			await handleReview(ctx, args);
			return { type: "handled" };

		case "help":
		case "?":
			handleHelp();
			return { type: "handled" };

		case "exit":
		case "quit":
		case "q":
			return { type: "exit" };

		default:
			writeln(
				`${PREFIX.error} unknown: /${command}  ${c.dim("— /help for commands")}`,
			);
			return { type: "unknown", command };
	}
}
