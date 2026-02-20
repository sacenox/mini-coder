import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as c from "yoctocolors";
import { type CommandContext, handleCommand } from "../cli/commands.ts";
import { readline, type InputResult } from "../cli/input.ts";
import {
	PREFIX,
	Spinner,
	renderError,
	renderInfo,
	renderStatusBar,
	renderTurn,
	restoreTerminal,
	writeln,
} from "../cli/output.ts";
import { getContextWindow, resolveModel } from "../llm-api/providers.ts";
import { type CoreMessage, runTurn } from "../llm-api/turn.ts";
import type { Message, ToolDef } from "../llm-api/types.ts";
import { connectMcpServer } from "../mcp/client.ts";
import {
	addPromptHistory,
	deleteLastTurn,
	getConfigDir,
	getMaxTurnIndex,
	listMcpServers,
	saveMessages,
	setPreferredModel,
} from "../session/db.ts";
import {
	type ActiveSession,
	newSession,
	resumeSession,
	touchActiveSession,
} from "../session/manager.ts";
import { buildReadOnlyToolSet, buildToolSet } from "./tools.ts";

// ─── Git branch detection ─────────────────────────────────────────────────────

async function getGitBranch(cwd: string): Promise<string | null> {
	try {
		const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const out = await new Response(proc.stdout).text();
		const code = await proc.exited;
		if (code !== 0) return null;
		return out.trim() || null;
	} catch {
		return null;
	}
}

// ─── Context file discovery (AGENTS.md / CLAUDE.md) ──────────────────────────

function loadContextFile(cwd: string): string | null {
	const candidates = [
		join(cwd, "AGENTS.md"),
		join(cwd, "CLAUDE.md"),
		join(getConfigDir(), "AGENTS.md"),
	];
	for (const p of candidates) {
		if (existsSync(p)) {
			try {
				return readFileSync(p, "utf-8");
			} catch {
				// skip
			}
		}
	}
	return null;
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(cwd: string): string {
	const contextFile = loadContextFile(cwd);
	const cwdDisplay = cwd.startsWith(homedir())
		? `~${cwd.slice(homedir().length)}`
		: cwd;
	const now = new Date().toLocaleString(undefined, { hour12: false });

	let prompt = `You are mini-coder, a small and fast CLI coding agent.
You have access to tools to read files, search code, make edits, run shell commands, and spawn subagents.

Current working directory: ${cwdDisplay}
Current date/time: ${now}

Guidelines:
- Be concise and precise. Avoid unnecessary preamble.
- Prefer small, targeted edits over large rewrites.
- Always read a file before editing it.
- Use glob to discover files, grep to find patterns, read to inspect contents.
- Use shell for tests, builds, and git operations.
- When in doubt, ask the user before making destructive changes.`;

	if (contextFile) {
		prompt += `\n\n# Project context\n\n${contextFile}`;
	}

	return prompt;
}

// ─── DB messages → raw ModelMessages (for session resume) ────────────────────
// On resume, the DB stores text-only messages. Tool-call/result parts are
// intentionally not reconstructed because the complex output/input shapes are
// opaque. Any tool-role entries are kept as plain text and treated as assistant
// messages for resume context.
function isTextPart(part: unknown): part is { type: "text"; text: string } {
	return (
		typeof part === "object" &&
		part !== null &&
		(part as { type?: unknown }).type === "text" &&
		typeof (part as { text?: unknown }).text === "string"
	);
}

function resumeRole(role: Message["role"]): "user" | "assistant" {
	// Tool-role entries are stored as plain text; treat them as assistant
	// messages when rebuilding context for the model.
	return role === "user" ? "user" : "assistant";
}

function dbMessagesToCore(messages: Message[]): CoreMessage[] {
	return messages.map((m): CoreMessage => {
		const role = resumeRole(m.role);
		if (typeof m.content === "string") {
			return { role, content: m.content };
		}
		if (Array.isArray(m.content)) {
			// Filter to text-only parts to avoid feeding malformed tool parts
			const textParts = m.content.filter(isTextPart);
			if (textParts.length > 0) {
				return {
					role,
					content: textParts,
				};
			}
			return { role, content: "" };
		}
		return { role, content: String(m.content) };
	});
}

// ─── Shell passthrough (! prefix) ─────────────────────────────────────────────

async function runShellPassthrough(
	command: string,
	cwd: string,
): Promise<string> {
	const proc = Bun.spawn(["bash", "-c", command], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	try {
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		await proc.exited;
		const out = [stdout, stderr].filter(Boolean).join("\n").trim();
		if (out) writeln(c.dim(out));
		return out;
	} finally {
		restoreTerminal();
	}
}

// ─── Main agent run ───────────────────────────────────────────────────────────

export interface AgentOptions {
	model: string;
	cwd: string;
	sessionId?: string; // resume existing
	initialPrompt?: string; // non-interactive first message
}

export async function runAgent(opts: AgentOptions): Promise<void> {
	const cwd = opts.cwd;
	let currentModel = opts.model;

	// Session setup
	let session: ActiveSession;
	if (opts.sessionId) {
		const resumed = resumeSession(opts.sessionId);
		if (!resumed) {
			renderError(`Session "${opts.sessionId}" not found.`);
			process.exit(1);
		}
		session = resumed;
		currentModel = session.model;
		renderInfo(`Resumed session ${session.id} (${c.cyan(currentModel)})`);
	} else {
		session = newSession(currentModel, cwd);
	}

	// Turn counter — incremented each time processUserInput is called
	// Used to group user + assistant messages for undo
	let turnIndex = getMaxTurnIndex(session.id) + 1;

	// Raw AI SDK ModelMessage history — fed directly to streamText each turn.
	// This is kept separate from session.messages (which is DB-persisted text)
	// to avoid lossy round-trips through our internal Message type.
	const coreHistory: CoreMessage[] = dbMessagesToCore(session.messages);

	// Subagent runner (recursive) — depth prevents infinite recursion
	const runSubagent = async (
		prompt: string,
		depth = 0,
	): Promise<{ result: string; inputTokens: number; outputTokens: number }> => {
		const subMessages: Message[] = [{ role: "user", content: prompt }];
		const subTools = buildToolSet({ cwd, depth, runSubagent });
		const subLlm = resolveModel(currentModel);

		const systemPrompt = buildSystemPrompt(cwd);

		let result = "";
		let inputTokens = 0;
		let outputTokens = 0;

		const events = runTurn({
			model: subLlm,
			messages: dbMessagesToCore(subMessages),
			tools: subTools,
			systemPrompt,
		});

		for await (const event of events) {
			if (event.type === "text-delta") result += event.delta;
			if (event.type === "turn-complete") {
				inputTokens = event.inputTokens;
				outputTokens = event.outputTokens;
			}
		}

		return { result, inputTokens, outputTokens };
	};

	// ── MCP: load persisted servers and connect them ───────────────────────────
	const tools: ToolDef[] = buildToolSet({ cwd, depth: 0, runSubagent });
	const mcpTools: ToolDef[] = [];

	async function connectAndAddMcp(name: string): Promise<void> {
		const rows = listMcpServers();
		const row = rows.find((r) => r.name === name);
		if (!row) throw new Error(`MCP server "${name}" not found in DB`);
		const cfg: Parameters<typeof connectMcpServer>[0] = {
			name: row.name,
			transport: row.transport as "http" | "stdio",
			...(row.url ? { url: row.url } : {}),
			...(row.command ? { command: row.command } : {}),
			...(row.args ? { args: JSON.parse(row.args) } : {}),
			...(row.env ? { env: JSON.parse(row.env) } : {}),
		};
		const client = await connectMcpServer(cfg);
		tools.push(...client.tools);
		mcpTools.push(...client.tools);
	}

	// Connect all persisted MCP servers at startup
	for (const row of listMcpServers()) {
		try {
			await connectAndAddMcp(row.name);
			renderInfo(`MCP: connected ${c.cyan(row.name)}`);
		} catch (e) {
			renderError(`MCP: failed to connect ${row.name}: ${String(e)}`);
		}
	}

	let planMode = false;

	const cmdCtx: CommandContext = {
		get currentModel() {
			return currentModel;
		},
		setModel: (m) => {
			currentModel = m;
			session.model = m;
			setPreferredModel(m);
		},
		get planMode() {
			return planMode;
		},
		setPlanMode: (v) => {
			planMode = v;
		},
		cwd,
		runSubagent: (prompt) => runSubagent(prompt),

		undoLastTurn: () => {
			// Nothing to undo if there are no messages
			if (session.messages.length === 0) return false;

			// Find the message index where the last turn starts (last user message)
			let lastUserIdx = -1;
			for (let i = session.messages.length - 1; i >= 0; i--) {
				if (session.messages[i]?.role === "user") {
					lastUserIdx = i;
					break;
				}
			}
			if (lastUserIdx === -1) return false;

			// Trim in-memory DB history
			session.messages.splice(lastUserIdx);

			// Trim coreHistory to match — find last user message in coreHistory
			let coreLastUserIdx = -1;
			for (let i = coreHistory.length - 1; i >= 0; i--) {
				if (coreHistory[i]?.role === "user") {
					coreLastUserIdx = i;
					break;
				}
			}
			if (coreLastUserIdx !== -1) coreHistory.splice(coreLastUserIdx);

			// Delete from DB and decrement turn counter
			const deleted = deleteLastTurn(session.id);
			if (turnIndex > 0) turnIndex--;
			return deleted;
		},
		connectMcpServer: connectAndAddMcp,
		startNewSession: () => {
			session = newSession(currentModel, cwd);
			coreHistory.length = 0;
			turnIndex = 1;
			totalIn = 0;
			totalOut = 0;
			lastContextTokens = 0;
		},
	};
	const spinner = new Spinner();
	let totalIn = 0;
	let totalOut = 0;
	let lastContextTokens = 0;

	// ── Handle initial prompt (non-interactive) ────────────────────────────────
	if (opts.initialPrompt) {
		await processUserInput(opts.initialPrompt);
	}

	// ── REPL ──────────────────────────────────────────────────────────────────
	while (true) {
		// Render the status bar to stdout before drawing the prompt so both are on
		// the same stream, guaranteeing correct ordering (no stderr/stdout race).
		await renderStatusBarForSession();

		let input: InputResult;
		try {
			input = await readline({ cwd, planMode });
		} catch {
			break;
		}

		switch (input.type) {
			case "eof":
				writeln(c.dim("Goodbye."));
				return;

			case "interrupt":
				// Just go back to prompt
				continue;

			case "command": {
				const result = await handleCommand(input.command, input.args, cmdCtx);
				if (result.type === "exit") {
					writeln(c.dim("Goodbye."));
					return;
				}
				if (result.type === "inject-user-message") {
					await processUserInput(result.text);
				}
				continue;
			}

			case "shell": {
				const out = await runShellPassthrough(input.command, cwd);
				if (out) {
					const thisTurn = turnIndex++;
					const msg: Message = {
						role: "user",
						content: `Shell output of \`${input.command}\`:\n\`\`\`\n${out}\n\`\`\``,
					};
					session.messages.push(msg);
					saveMessages(session.id, [msg], thisTurn);
					coreHistory.push({ role: "user", content: String(msg.content) });
				}
				continue;
			}

			case "submit":
				await processUserInput(input.text);
				continue;
		}
	}

	// ── Process a user message ─────────────────────────────────────────────────
	async function processUserInput(text: string): Promise<void> {
		// Resolve @file references
		const resolvedText = await resolveFileRefs(text, cwd);

		// Capture turn index for this turn (user + response share the same index)
		const thisTurn = turnIndex++;

		const userMsg: Message = { role: "user", content: resolvedText };
		session.messages.push(userMsg);
		saveMessages(session.id, [userMsg], thisTurn);

		// Also push into coreHistory as a raw ModelMessage.
		// In plan mode, append the system-message suffix so the model knows it
		// should only read/explore — not execute write operations.
		const coreContent = planMode
			? `${resolvedText}\n\n<system-message>PLAN MODE ACTIVE: Help the user gather context for the plan -- READ ONLY</system-message>`
			: resolvedText;
		coreHistory.push({ role: "user", content: coreContent });

		const llm = resolveModel(currentModel);
		const systemPrompt = buildSystemPrompt(cwd);

		const abortController = new AbortController();
		const onSigInt = () => abortController.abort();
		process.once("SIGINT", onSigInt);

		spinner.start("thinking");

		const events = runTurn({
			model: llm,
			messages: coreHistory,
			tools: planMode ? [...buildReadOnlyToolSet({ cwd }), ...mcpTools] : tools,
			systemPrompt,
			signal: abortController.signal,
		});

		const { inputTokens, outputTokens, contextTokens, newMessages } =
			await renderTurn(events, spinner);
		process.removeListener("SIGINT", onSigInt);

		// newMessages are raw ModelMessage objects — push directly into coreHistory
		// so subsequent turns have the correct input/output fields.
		if (newMessages.length > 0) {
			coreHistory.push(...newMessages);
			// For DB persistence, store a simplified version (text only is enough
			// for session resume context — tool call parts are not reconstructed).
			const dbMsgs: Message[] = newMessages.map((m) => {
				const role = m.role as Message["role"];
				const content = m.content;
				if (typeof content === "string") {
					return { role, content };
				}
				if (Array.isArray(content)) {
					// Collapse to text content only for DB storage
					const text = content
						.filter(isTextPart)
						.map((p) => p.text)
						.join("");
					return { role, content: text };
				}
				return { role, content: String(content) };
			});
			session.messages.push(...dbMsgs);
			saveMessages(session.id, dbMsgs, thisTurn);
		}

		totalIn += inputTokens;
		totalOut += outputTokens;
		lastContextTokens = contextTokens;
		touchActiveSession(session);
	}

	// ── Render status bar (called before each prompt) ──────────────────────────
	async function renderStatusBarForSession(): Promise<void> {
		const branch = await getGitBranch(cwd);
		const provider = currentModel.split("/")[0] ?? "";
		const modelShort = currentModel.split("/").slice(1).join("/");
		const cwdDisplay = cwd.startsWith(homedir())
			? `~${cwd.slice(homedir().length)}`
			: cwd;

		renderStatusBar({
			model: modelShort,
			provider,
			cwd: cwdDisplay,
			gitBranch: branch,
			sessionId: session.id,
			inputTokens: totalIn,
			outputTokens: totalOut,
			contextTokens: lastContextTokens,
			contextWindow: getContextWindow(currentModel),
		});
	}
}

// ─── Resolve @file references in user input ────────────────────────────────────

async function resolveFileRefs(text: string, cwd: string): Promise<string> {
	// Find all @<path> tokens
	const atPattern = /@([\w./\-_]+)/g;
	let result = text;
	const matches = [...text.matchAll(atPattern)];

	for (const match of matches.reverse()) {
		const ref = match[1];
		if (!ref) continue;
		const filePath = ref.startsWith("/") ? ref : join(cwd, ref);

		try {
			const content = await Bun.file(filePath).text();
			const lines = content.split("\n");
			const preview =
				lines.length > 200
					? `${lines.slice(0, 200).join("\n")}\n[truncated]`
					: content;
			const replacement = `\`${ref}\`:\n\`\`\`\n${preview}\n\`\`\``;
			result =
				result.slice(0, match.index) +
				replacement +
				result.slice((match.index ?? 0) + match[0].length);
		} catch {
			// Leave the @ref as-is if file not found
		}
	}

	return result;
}
