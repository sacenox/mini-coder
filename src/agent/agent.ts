import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as c from "yoctocolors";
import { loadAgents } from "../cli/agents.ts";
import { type CommandContext, handleCommand } from "../cli/commands.ts";
import {
	type ImageAttachment,
	isImageFilename,
	loadImageFile,
} from "../cli/image-types.ts";
import { readline, type InputResult, watchForInterrupt } from "../cli/input.ts";
import {
	PREFIX,
	Spinner,
	formatSubagentLabel,
	renderError,
	renderHook,
	renderInfo,
	renderStatusBar,
	renderSubagentEvent,
	renderTurn,
	restoreTerminal,
	tildePath,
	writeln,
} from "../cli/output.ts";
import { loadSkills } from "../cli/skills.ts";

import {
	getContextWindow,
	parseModelString,
	resolveModel,
} from "../llm-api/providers.ts";
import { type CoreMessage, runTurn } from "../llm-api/turn.ts";
import type { ToolDef } from "../llm-api/types.ts";
import { connectMcpServer } from "../mcp/client.ts";
import {
	type SnapshotRestoreResult,
	restoreSnapshot,
	takeSnapshot,
} from "../tools/snapshot.ts";
import type { SubagentOutput } from "../tools/subagent.ts";

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

// Extra directives injected when the model is a Codex variant.
// Codex is RLHF-tuned to be collaborative and permission-seeking by default;
// without these overrides it will read a few files, describe what it *plans*
// to do, and then stop — even in ralph mode. The Responses API `instructions`
// field (used for all gpt-* models) is the authoritative channel for these.
const CODEX_AUTONOMY = `
# Autonomy and persistence
- You are an autonomous senior engineer. Once given a direction, proactively gather context, implement, test, and refine without waiting for additional prompts at each step.
- Persist until the task is fully handled end-to-end within the current turn: do not stop at analysis or partial work; carry changes through to implementation and verification.
- Bias to action: default to implementing with reasonable assumptions. Do not end your turn with clarifications or requests to "proceed" unless you are truly blocked on information only the user can provide.
- Do NOT output an upfront plan, preamble, or status update before working. Start making tool calls immediately.
- Do NOT ask "shall I proceed?", "shall I start?", "reply X to continue", or any equivalent. Just start.
- If something is ambiguous, pick the most reasonable interpretation, implement it, and note the assumption at the end.`;

function isCodexModel(modelString: string): boolean {
	const { modelId } = parseModelString(modelString);
	return modelId.includes("codex");
}

function buildSystemPrompt(cwd: string, modelString?: string): string {
	const contextFile = loadContextFile(cwd);
	const cwdDisplay = tildePath(cwd);
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
- Use shell for tests, builds, and git operations.`;

	if (modelString && isCodexModel(modelString)) {
		prompt += CODEX_AUTONOMY;
	}

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

	let nextLaneId = 1;
	const activeLanes = new Set<number>();

	// Subagent runner (recursive) — depth prevents infinite recursion.
	// agentName: optional custom agent to run (looks up .agents/agents/<name>.md).
	// modelOverride: explicit model to use (for /review and custom commands).
	const runSubagent = async (
		prompt: string,
		depth = 0,
		agentName?: string,
		modelOverride?: string,
		parentLabel?: string,
	): Promise<SubagentOutput> => {
		// Resolve custom agent config if an agentName was specified
		const allAgents = loadAgents(cwd);
		const agentConfig = agentName ? allAgents.get(agentName) : undefined;
		if (agentName && !agentConfig) {
			throw new Error(
				`Unknown agent "${agentName}". Available agents: ${[...allAgents.keys()].join(", ") || "(none)"}`,
			);
		}

		const model = modelOverride ?? agentConfig?.model ?? currentModel;
		const systemPrompt =
			agentConfig?.systemPrompt ?? buildSystemPrompt(cwd, model);

		const subMessages: CoreMessage[] = [{ role: "user", content: prompt }];
		const laneId = nextLaneId++;
		activeLanes.add(laneId);
		const laneLabel = formatSubagentLabel(laneId, parentLabel);

		const subTools = buildToolSet({
			cwd,
			depth,
			runSubagent,
			onHook: renderHook,
			availableAgents: allAgents,
			parentLabel: laneLabel,
		});

		const subLlm = resolveModel(model);

		let result = "";
		let inputTokens = 0;
		let outputTokens = 0;

		const events = runTurn({
			model: subLlm,
			modelString: model,
			messages: subMessages,
			tools: subTools,
			systemPrompt,
		});

		for await (const event of events) {
			spinner.stop();
			renderSubagentEvent(event, { laneId, parentLabel, activeLanes });
			spinner.start("thinking");
			if (event.type === "text-delta") result += event.delta;
			if (event.type === "turn-complete") {
				inputTokens = event.inputTokens;
				outputTokens = event.outputTokens;
			}
		}

		activeLanes.delete(laneId);
		return { result, inputTokens, outputTokens };
	};

	// ── MCP: load persisted servers and connect them ───────────────────────────

	const agents = loadAgents(cwd);
	const tools: ToolDef[] = buildToolSet({
		cwd,
		depth: 0,
		runSubagent,
		onHook: renderHook,
		availableAgents: agents,
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
		// depth=0: custom commands are user-initiated, not LLM-initiated, so they
		// don't consume the recursion depth guard (which only applies to the LLM
		// subagent tool calling itself).
		// model? is an optional override for /review and custom commands.
		runSubagent: (prompt, model?) => runSubagent(prompt, 0, undefined, model),

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
				let lastText = await processUserInput(input.text, input.images);

				if (ralphMode) {
					const goal = input.text;
					const goalImages = input.images;
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
						lastText = await processUserInput(goal, goalImages);
					}
				}
				continue;
			}
		}
	}

	// ── Process a user message ─────────────────────────────────────────────────
	async function processUserInput(
		text: string,
		pastedImages: ImageAttachment[] = [],
	): Promise<string> {
		// Watch for Ctrl+C by reading raw stdin bytes. This is more reliable than
		// SIGINT listeners in Bun: when stdin is in raw mode, the OS sends 0x03
		// directly instead of raising a signal that Bun may intercept or swallow.
		const abortController = new AbortController();
		let wasAborted = false;
		abortController.signal.addEventListener("abort", () => {
			wasAborted = true;
		});
		const stopWatcher = watchForInterrupt(abortController);

		// Resolve @file/skill references (agent refs are left as-is for the LLM)
		const { text: resolvedText, images: refImages } = await resolveFileRefs(
			text,
			cwd,
		);

		// Merge pasted images with @-ref images
		const allImages = [...pastedImages, ...refImages];

		// Capture turn index for this turn (user + response share the same index)
		const thisTurn = turnIndex++;

		// Snapshot working tree before anything is persisted or sent to the LLM.
		// Saves dirty file contents to SQLite so /undo can restore them without
		// touching git stash or the user's working tree state.
		const snapped = await takeSnapshot(cwd, session.id, thisTurn);

		const coreContent = planMode
			? `${resolvedText}\n\n<system-message>PLAN MODE ACTIVE: Help the user gather context for the plan -- READ ONLY</system-message>`
			: ralphMode
				? `${resolvedText}\n\n<system-message>RALPH MODE: You are in an autonomous loop. You MUST make actual file changes (create, edit, or write files) to complete the requested task before outputting \`/ralph\`. Reading files, running tests, or exploring the codebase does NOT count as doing the work. Only output \`/ralph\` as your final message after all requested changes are implemented and tests pass.</system-message>`
				: resolvedText;

		// Build the message content — multi-part when images are present
		const userMsg: CoreMessage =
			allImages.length > 0
				? {
						role: "user",
						content: [
							{ type: "text", text: coreContent },
							...allImages.map((img) => ({
								type: "image" as const,
								image: img.data,
								mediaType: img.mediaType,
							})),
						],
					}
				: { role: "user", content: coreContent };

		// If CTRL+C was pressed during the async preamble, still save the user
		// message and a stub assistant reply so the turn stays in history.
		// /undo is the only way to erase a turn.
		if (wasAborted) {
			stopWatcher();
			const stubMsg = makeInterruptMessage("user");
			session.messages.push(userMsg, stubMsg);
			saveMessages(session.id, [userMsg, stubMsg], thisTurn);
			coreHistory.push(userMsg, stubMsg);
			snapshotStack.push(snapped ? thisTurn : null);
			touchActiveSession(session);
			return "";
		}

		session.messages.push(userMsg);
		saveMessages(session.id, [userMsg], thisTurn);
		coreHistory.push(userMsg);

		const llm = resolveModel(currentModel);
		const systemPrompt = buildSystemPrompt(cwd, currentModel);

		let lastAssistantText = "";
		// Tracks whether the catch block stub has already been saved, to avoid
		// double-appending if somehow both paths fire.
		let errorStubSaved = false;

		try {
			// Always push so the stack stays aligned 1:1 with turns. A null entry means
			// the tree was clean at snapshot time — /undo will roll back conversation
			// history but skip file restoration for that turn.
			snapshotStack.push(snapped ? thisTurn : null);

			spinner.start("thinking");

			const events = runTurn({
				model: llm,
				modelString: currentModel,
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
				if (wasAborted) {
					// Had partial content — append a system message block so the model
					// knows the response was cut short. /undo is the only way to erase.
					const note = makeInterruptMessage("user");
					coreHistory.push(note);
					session.messages.push(note);
					saveMessages(session.id, [note], thisTurn);
				}
			} else {
				// No messages returned — interrupted before any content. Save a
				// synthetic assistant message. /undo is the only way to erase a turn.
				const stubMsg = makeInterruptMessage("user");
				coreHistory.push(stubMsg);
				session.messages.push(stubMsg);
				saveMessages(session.id, [stubMsg], thisTurn);
			}

			// Collect all assistant text from this turn so the ralph loop can detect
			// the /ralph signal even when the final action was a tool call.
			lastAssistantText = extractAssistantText(newMessages);

			totalIn += inputTokens;
			totalOut += outputTokens;
			lastContextTokens = contextTokens;
			touchActiveSession(session);
		} catch (err) {
			// Unexpected throw (network failure, etc.). Append a system message block
			// so history stays valid. /undo is the only way to erase a turn.
			if (!errorStubSaved) {
				errorStubSaved = true;
				const stubMsg = makeInterruptMessage("error");
				coreHistory.push(stubMsg);
				session.messages.push(stubMsg);
				saveMessages(session.id, [stubMsg], thisTurn);
			}
			throw err;
		} finally {
			stopWatcher();
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
		const cwdDisplay = tildePath(cwd);

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

// ─── Interrupt stub helpers ───────────────────────────────────────────────────

/**
 * Returns a synthetic assistant CoreMessage signalling that the turn was
 * interrupted by the user (Ctrl+C) or by an error.  Used in four places:
 *   1. Preamble abort (Ctrl+C before LLM call starts)
 *   2. Mid-stream abort with no partial content
 *   3. Mid-stream abort with partial content (appended after real messages)
 *   4. Unexpected throw in the catch block
 */
export function makeInterruptMessage(reason: "user" | "error"): CoreMessage {
	const text =
		reason === "user"
			? "<system-message>Response was interrupted by the user.</system-message>"
			: "<system-message>Response was interrupted due to an error.</system-message>";
	return { role: "assistant", content: text };
}

// ─── Ralph signal detection ───────────────────────────────────────────────────

/**
 * Collect all text from assistant messages in a turn's newMessages array.
 * Scans every assistant message (not just the last) so that a trailing tool
 * call doesn't mask a `/ralph` signal that appeared in earlier text.
 */
export function extractAssistantText(newMessages: CoreMessage[]): string {
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

// ─── Resolve @file/skill references in user input ────────────────────────────
// @agent references are left as-is — unrecognised @refs simply fall through to
// the file-inject path and are left unchanged when the file doesn't exist.

async function resolveFileRefs(
	text: string,
	cwd: string,
): Promise<{ text: string; images: ImageAttachment[] }> {
	const atPattern = /@([\w./\-_]+)/g;
	let result = text;
	const matches = [...text.matchAll(atPattern)];
	const images: ImageAttachment[] = [];

	const skills = loadSkills(cwd);

	// Substitute skills, images, and files (right-to-left).
	for (const match of [...matches].reverse()) {
		const ref = match[1];
		if (!ref) continue;

		// @skill-name — inject skill content inline
		const skill = skills.get(ref);
		if (skill) {
			const replacement = `<skill name="${skill.name}">\n${skill.content}\n</skill>`;
			result =
				result.slice(0, match.index) +
				replacement +
				result.slice((match.index ?? 0) + match[0].length);
			continue;
		}

		const filePath = ref.startsWith("/") ? ref : join(cwd, ref);

		// @image-path — read as base64 attachment
		if (isImageFilename(ref)) {
			const attachment = await loadImageFile(filePath);
			if (attachment) {
				images.unshift(attachment); // reverse() + unshift = left-to-right order
				result =
					result.slice(0, match.index) +
					result.slice((match.index ?? 0) + match[0].length);
				continue;
			}
		}

		// @file-path — inject file contents inline
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

	return { text: result, images };
}
