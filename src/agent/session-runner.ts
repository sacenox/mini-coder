import * as c from "yoctocolors";
import type { ImageAttachment } from "../cli/image-types.ts";
import { watchForCancel } from "../cli/input.ts";
import type { ThinkingEffort } from "../llm-api/providers.ts";
import { resolveModel } from "../llm-api/providers.ts";
import type { ContextPruningMode, CoreMessage } from "../llm-api/turn.ts";
import { runTurn } from "../llm-api/turn.ts";
import type { ToolDef } from "../llm-api/types.ts";
import {
	deleteAllSnapshots,
	getMaxTurnIndex,
	saveMessages,
} from "../session/db/index.ts";
import type { ActiveSession } from "../session/manager.ts";
import {
	newSession,
	resumeSession,
	touchActiveSession,
} from "../session/manager.ts";
import { takeSnapshot } from "../tools/snapshot.ts";
import { extractAssistantText, makeInterruptMessage } from "./agent-helpers.ts";
import type { AgentReporter } from "./reporter.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import { buildReadOnlyToolSet } from "./tools.ts";

interface SessionRunnerOptions {
	cwd: string;
	reporter: AgentReporter;
	tools: ToolDef[];
	mcpTools: ToolDef[];
	initialModel: string;
	initialThinkingEffort: ThinkingEffort | null;
	initialShowReasoning: boolean;
	initialPruningMode: ContextPruningMode;
	initialToolResultPayloadCapBytes: number;
	sessionId?: string | undefined;
	extraSystemPrompt?: string | undefined;
	isSubagent?: boolean | undefined;
	killSubprocesses?: (() => void) | undefined;
}

export class SessionRunner {
	public cwd: string;
	public reporter: AgentReporter;
	public tools: ToolDef[];
	public mcpTools: ToolDef[];
	public currentModel: string;
	public currentThinkingEffort: ThinkingEffort | null;
	public showReasoning: boolean;
	public pruningMode: ContextPruningMode;
	public toolResultPayloadCapBytes: number;

	public session!: ActiveSession;
	public coreHistory!: CoreMessage[];
	public turnIndex = 1;
	public snapshotStack: Array<number | null> = [];

	public planMode = false;
	public ralphMode = false;

	public totalIn = 0;
	public totalOut = 0;
	public lastContextTokens = 0;
	public extraSystemPrompt: string | undefined;
	private isSubagent: boolean | undefined;
	private killSubprocesses: (() => void) | undefined;

	constructor(opts: SessionRunnerOptions) {
		this.cwd = opts.cwd;
		this.reporter = opts.reporter;
		this.tools = opts.tools;
		this.mcpTools = opts.mcpTools;
		this.currentModel = opts.initialModel;
		this.currentThinkingEffort = opts.initialThinkingEffort;
		this.showReasoning = opts.initialShowReasoning;
		this.pruningMode = opts.initialPruningMode;
		this.toolResultPayloadCapBytes = opts.initialToolResultPayloadCapBytes;
		this.extraSystemPrompt = opts.extraSystemPrompt;
		this.isSubagent = opts.isSubagent;
		this.killSubprocesses = opts.killSubprocesses;
		this.initSession(opts.sessionId);
	}

	public initSession(sessionId?: string) {
		if (sessionId) {
			const resumed = resumeSession(sessionId);
			if (!resumed) {
				this.reporter.error(`Session "${sessionId}" not found.`);
				process.exit(1);
			}
			this.session = resumed;
			this.currentModel = this.session.model;
			deleteAllSnapshots(this.session.id);
			this.reporter.info(
				`Resumed session ${this.session.id} (${c.cyan(this.currentModel)})`,
			);
		} else {
			this.session = newSession(this.currentModel, this.cwd);
		}
		this.turnIndex = getMaxTurnIndex(this.session.id) + 1;
		this.coreHistory = [...this.session.messages];
	}

	public startNewSession() {
		deleteAllSnapshots(this.session.id);
		this.session = newSession(this.currentModel, this.cwd);
		this.coreHistory.length = 0;
		this.turnIndex = 1;
		this.totalIn = 0;
		this.totalOut = 0;
		this.lastContextTokens = 0;
		this.snapshotStack.length = 0;
	}

	public async processUserInput(
		text: string,
		pastedImages: ImageAttachment[] = [],
	): Promise<string> {
		const abortController = new AbortController();
		const stopWatcher = watchForCancel(abortController);

		if (this.killSubprocesses) {
			const killSubs = this.killSubprocesses;
			abortController.signal.addEventListener("abort", () => {
				killSubs();
			});
		}
		const allImages = [...pastedImages];
		const thisTurn = this.turnIndex++;

		const snapped = await takeSnapshot(this.cwd, this.session.id, thisTurn);

		const coreContent = this.planMode
			? `${text}\n\n<system-message>PLAN MODE ACTIVE: Help the user gather context for the plan -- READ ONLY</system-message>`
			: text;

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

		this.session.messages.push(userMsg);
		saveMessages(this.session.id, [userMsg], thisTurn);
		this.coreHistory.push(userMsg);

		const llm = resolveModel(this.currentModel);
		const systemPrompt = buildSystemPrompt(
			this.cwd,
			this.extraSystemPrompt,
			this.isSubagent,
		);

		let lastAssistantText = "";

		try {
			this.snapshotStack.push(snapped ? thisTurn : null);

			this.reporter.startSpinner("thinking");
			const events = runTurn({
				model: llm,
				modelString: this.currentModel,
				messages: this.coreHistory,
				tools: this.planMode
					? [...buildReadOnlyToolSet({ cwd: this.cwd }), ...this.mcpTools]
					: this.tools,
				systemPrompt,
				signal: abortController.signal,
				pruningMode: this.pruningMode,
				toolResultPayloadCapBytes: this.toolResultPayloadCapBytes,
				...(this.currentThinkingEffort
					? { thinkingEffort: this.currentThinkingEffort }
					: {}),
			});

			const { inputTokens, outputTokens, contextTokens, newMessages } =
				await this.reporter.renderTurn(events, {
					showReasoning: this.showReasoning,
				});

			if (newMessages.length > 0) {
				this.coreHistory.push(...newMessages);
				this.session.messages.push(...newMessages);
				saveMessages(this.session.id, newMessages, thisTurn);
			}

			lastAssistantText = extractAssistantText(newMessages);

			this.totalIn += inputTokens;
			this.totalOut += outputTokens;
			this.lastContextTokens = contextTokens;
			touchActiveSession(this.session);
		} catch (err) {
			const stubMsg = makeInterruptMessage("error");
			this.coreHistory.push(stubMsg);
			this.session.messages.push(stubMsg);
			saveMessages(this.session.id, [stubMsg], thisTurn);
			throw err;
		} finally {
			stopWatcher();
		}

		return lastAssistantText;
	}
}
