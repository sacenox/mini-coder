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
	renderHook,
	renderInfo,
	renderStatusBar,
	renderTurn,
	restoreTerminal,
	writeln,
} from "../cli/output.ts";

import { getContextWindow, resolveModel } from "../llm-api/providers.ts";
import { type CoreMessage, runTurn } from "../llm-api/turn.ts";
import type { ToolDef } from "../llm-api/types.ts";
import { connectMcpServer } from "../mcp/client.ts";
import {
	type SnapshotRestoreResult,
	restoreSnapshot,
	takeSnapshot,
} from "../tools/snapshot.ts";

import {
	deleteAllSnapshots,
	deleteLastTurn,
	deleteSnapshot,
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
		// Orphaned snapshot rows from a previous run can never be reached by the
		// fresh in-memory snapshotStack — delete them so they don't accumulate.
		deleteAllSnapshots(session.id);
		renderInfo(`Resumed session ${session.id} (${c.cyan(currentModel)})`);
	} else {
		session = newSession(currentModel, cwd);
	}

	// Turn counter — incremented each time processUserInput is called
	// Used to group user + assistant messages for undo
	let turnIndex = getMaxTurnIndex(session.id) + 1;

	// Raw AI SDK ModelMessage history — fed directly to streamText each turn.
	// This is kept separate from session.messages (DB-persisted CoreMessages)
	// so we can trim or rebuild without mutating the in-memory DB copy.
	const coreHistory: CoreMessage[] = [...session.messages];

	// Subagent runner (recursive) — depth prevents infinite recursion
	const runSubagent = async (
		prompt: string,
		depth = 0,
	): Promise<import("../tools/subagent.ts").SubagentOutput> => {
		const subMessages: CoreMessage[] = [{ role: "user", content: prompt }];
		const subTools = buildToolSet({
			cwd,
			depth,
			runSubagent,
			onHook: renderHook,
		});

		const subLlm = resolveModel(currentModel);

		const systemPrompt = buildSystemPrompt(cwd);

		let result = "";
		let inputTokens = 0;
		let outputTokens = 0;
		const activity: import("../tools/subagent.ts").SubagentToolEntry[] = [];

		// Track pending tool call so we can pair it with its result
		const pendingCalls = new Map<string, { toolName: string; args: unknown }>();

		const events = runTurn({
			model: subLlm,
			messages: subMessages,
			tools: subTools,
			systemPrompt,
		});

		for await (const event of events) {
			if (event.type === "text-delta") result += event.delta;
			if (event.type === "tool-call-start") {
				pendingCalls.set(event.toolCallId, {
					toolName: event.toolName,
					args: event.args,
				});
			}
			if (event.type === "tool-result") {
				const pending = pendingCalls.get(event.toolCallId);
				if (pending) {
					pendingCalls.delete(event.toolCallId);
					activity.push({
						toolName: pending.toolName,
						args: pending.args,
						result: event.result,
						isError: event.isError,
					});
				}
			}
			if (event.type === "turn-complete") {
				inputTokens = event.inputTokens;
				outputTokens = event.outputTokens;
			}
		}

		return { result, inputTokens, outputTokens, activity };
	};

	// ── MCP: load persisted servers and connect them ───────────────────────────
	const tools: ToolDef[] = buildToolSet({
		cwd,
		depth: 0,
		runSubagent,
		onHook: renderHook,
	});

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
	let ralphMode = false;

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
		get ralphMode() {
			return ralphMode;
		},
		setRalphMode: (v) => {
			ralphMode = v;
		},
		setPlanMode: (v) => {
			planMode = v;
		},
		cwd,
		runSubagent: (prompt) => runSubagent(prompt),

		undoLastTurn: async () => {
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
			const poppedTurn = snapshotStack.pop() ?? null;
			if (turnIndex > 0) turnIndex--;

			// Restore files from the SQLite snapshot for the turn being undone
			if (poppedTurn !== null) {
				const restoreResult: SnapshotRestoreResult = await restoreSnapshot(
					cwd,
					session.id,
					poppedTurn,
				);
				if (
					restoreResult.restored === false &&
					restoreResult.reason === "error"
				) {
					renderError(
						"snapshot restore failed — some files may not have been reverted",
					);
				}
			}

			return deleted;
		},
		connectMcpServer: connectAndAddMcp,
		startNewSession: () => {
			deleteAllSnapshots(session.id);
			session = newSession(currentModel, cwd);
			coreHistory.length = 0;
			turnIndex = 1;
			totalIn = 0;
			totalOut = 0;
			lastContextTokens = 0;
			snapshotStack.length = 0;
		},
	};
	const spinner = new Spinner();
	let totalIn = 0;
	let totalOut = 0;
	let lastContextTokens = 0;
	// Stack aligned 1:1 with turns. Each processUserInput pushes the turn index
	// when a snapshot was created, or null when the tree was clean. Each
	// undoLastTurn pops the top so the indices always correspond to the right turn.
	const snapshotStack: Array<number | null> = [];

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
			input = await readline({ cwd, planMode, ralphMode });
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
					const msg: CoreMessage = {
						role: "user",
						content: `Shell output of \`${input.command}\`:\n\`\`\`\n${out}\n\`\`\``,
					};
					session.messages.push(msg);
					saveMessages(session.id, [msg], thisTurn);
					coreHistory.push(msg);
				}
				continue;
			}

			case "submit": {
				const RALPH_MAX_ITERATIONS = 20;
				let ralphIteration = 1;
				let lastText = await processUserInput(input.text);
				if (ralphMode) {
					const goal = input.text;
					while (ralphMode) {
						// If the LLM signalled done, stop before starting another iteration.
						if (hasRalphSignal(lastText)) {
							ralphMode = false;
							writeln(`${PREFIX.info} ${c.dim("ralph mode off")}`);
							break;
						}
						if (ralphIteration >= RALPH_MAX_ITERATIONS) {
							writeln(
								`${PREFIX.info} ${c.yellow("ralph")} ${c.dim("— max iterations reached, stopping")}`,
							);
							ralphMode = false;
							break;
						}
						ralphIteration++;
						cmdCtx.startNewSession();
						lastText = await processUserInput(goal);
					}
				}
				continue;
			}
		}
	}

	// ── Process a user message ─────────────────────────────────────────────────
	async function processUserInput(text: string): Promise<string> {
		// Resolve @file references
		const resolvedText = await resolveFileRefs(text, cwd);

		// Capture turn index for this turn (user + response share the same index)
		const thisTurn = turnIndex++;

		// Snapshot working tree before anything is persisted or sent to the LLM.
		// Saves dirty file contents to SQLite so /undo can restore them without
		// touching git stash or the user's working tree state.
		const snapped = await takeSnapshot(cwd, session.id, thisTurn);

		const coreContent = planMode
			? `${resolvedText}\n\n<system-message>PLAN MODE ACTIVE: Help the user gather context for the plan -- READ ONLY</system-message>`
			: ralphMode
				? `${resolvedText}\n\n<system-message>RALPH MODE: You are in an autonomous loop. When the task is fully complete (all tests pass, no outstanding issues), output exactly \`/ralph\` as your final message to exit the loop. Otherwise, keep working.</system-message>`
				: resolvedText;
		const userMsg: CoreMessage = { role: "user", content: coreContent };
		session.messages.push(userMsg);
		saveMessages(session.id, [userMsg], thisTurn);
		coreHistory.push(userMsg);

		const llm = resolveModel(currentModel);
		const systemPrompt = buildSystemPrompt(cwd);

		const abortController = new AbortController();
		let wasAborted = false;
		const onSigInt = () => {
			wasAborted = true;
			abortController.abort();
			process.removeListener("SIGINT", onSigInt);
		};
		process.on("SIGINT", onSigInt);

		let lastAssistantText = "";
		// Tracks whether the turn was fully committed (assistant messages saved).
		// Used by rollbackTurn() to avoid double-rolling-back.
		let turnRolledBack = false;

		// Roll back the user message saved before the LLM call, so a failed turn
		// doesn't leave two consecutive user messages that would permanently break
		// the session by failing ModelMessage[] schema validation.
		const rollbackTurn = () => {
			if (turnRolledBack) return;
			turnRolledBack = true;
			coreHistory.pop();
			session.messages.pop();
			deleteLastTurn(session.id, thisTurn);
			if (snapped) deleteSnapshot(session.id, thisTurn);
			snapshotStack.pop();
			turnIndex--; // safe: thisTurn = turnIndex++ so turnIndex >= 1 here
		};

		try {
			// Always push so the stack stays aligned 1:1 with turns. A null entry means
			// the tree was clean at snapshot time — /undo will roll back conversation
			// history but skip file restoration for that turn.
			snapshotStack.push(snapped ? thisTurn : null);

			spinner.start("thinking");

			const events = runTurn({
				model: llm,
				messages: coreHistory,
				tools: planMode
					? [...buildReadOnlyToolSet({ cwd }), ...mcpTools]
					: tools,
				systemPrompt,
				signal: abortController.signal,
			});

			const { inputTokens, outputTokens, contextTokens, newMessages } =
				await renderTurn(events, spinner);

			// newMessages are raw ModelMessage objects — push directly into coreHistory
			// so subsequent turns have the correct input/output fields.
			if (newMessages.length > 0) {
				coreHistory.push(...newMessages);
				session.messages.push(...newMessages);
				saveMessages(session.id, newMessages, thisTurn);
			} else {
				// Turn produced no assistant reply (e.g. schema validation error or
				// abort). Roll back the user message so the next user input doesn't
				// create two consecutive user messages.
				rollbackTurn();
			}

			// Collect all assistant text from this turn so the ralph loop can detect
			// the /ralph signal even when the final action was a tool call.
			lastAssistantText = extractAssistantText(newMessages);

			totalIn += inputTokens;
			totalOut += outputTokens;
			lastContextTokens = contextTokens;
			touchActiveSession(session);
		} catch (err) {
			// Unexpected throw (network failure, etc.). Roll back if not already done.
			rollbackTurn();
			throw err;
		} finally {
			process.removeListener("SIGINT", onSigInt);
			// Stop the ralph loop on Ctrl+C or any unexpected throw, so the user
			// gets back to the prompt rather than resuming with a stale ralphMode=true.
			if (wasAborted) ralphMode = false;
		}

		return lastAssistantText;
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
			ralphMode,
		});
	}
}

// ─── Ralph signal detection ───────────────────────────────────────────────────

/**
 * Collect all text from assistant messages in a turn's newMessages array.
 * Scans every assistant message (not just the last) so that a trailing tool
 * call doesn't mask a `/ralph` signal that appeared in earlier text.
 */
export function extractAssistantText(
	newMessages: import("../llm-api/turn.ts").CoreMessage[],
): string {
	const parts: string[] = [];
	for (const msg of newMessages) {
		if (msg.role !== "assistant") continue;
		const content = msg.content;
		if (typeof content === "string") {
			parts.push(content);
		} else if (Array.isArray(content)) {
			for (const part of content as Array<{ type?: string; text?: string }>) {
				if (part?.type === "text" && part.text) parts.push(part.text);
			}
		}
	}
	return parts.join("\n");
}

/**
 * Returns true if the assistant text contains the `/ralph` stop signal.
 * Matches `/ralph` as a word boundary so surrounding prose is allowed
 * (e.g. "All done. /ralph" or "/ralph\n").
 */
export function hasRalphSignal(text: string): boolean {
	return /\/ralph\b/.test(text);
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
