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
import { snapshotBeforeEdit } from "../tools/snapshot.ts";
import { extractAssistantText, makeInterruptMessage } from "./agent-helpers.ts";
import type { AgentReporter } from "./reporter.ts";
import { buildSystemPrompt } from "./system-prompt.ts";

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
	initialPromptCachingEnabled: boolean;
	initialOpenAIPromptCacheRetention: "in_memory" | "24h";
	initialGoogleCachedContent: string | null;
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
	public promptCachingEnabled: boolean;
	public openaiPromptCacheRetention: "in_memory" | "24h";
	public googleCachedContent: string | null;

	public session!: ActiveSession;
	public sessionTimeAnchor!: string;
	public coreHistory!: CoreMessage[];
	public turnIndex = 1;
	public snapshotStack: Array<number | null> = [];
	public currentSnappedPaths: Set<string> | null = null;
	public currentTurn: number | null = null;

	public async snapshotCallback(filePath: string) {
		if (this.currentTurn !== null && this.currentSnappedPaths !== null) {
			await snapshotBeforeEdit(
				this.cwd,
				this.session.id,
				this.currentTurn,
				filePath,
				this.currentSnappedPaths,
			);
		}
	}

	public ralphMode = false;

	public totalIn = 0;
	public totalOut = 0;
	public lastContextTokens = 0;
	// Cache the system prompt so the file-system reads in buildSystemPrompt
	// (context files, skills index) are not repeated on every processUserInput call.
	private _extraSystemPrompt: string | undefined;
	private _systemPrompt: string | undefined;

	public get extraSystemPrompt(): string | undefined {
		return this._extraSystemPrompt;
	}

	public set extraSystemPrompt(value: string | undefined) {
		this._extraSystemPrompt = value;
		this.rebuildSystemPrompt();
	}

	private rebuildSystemPrompt(): void {
		if (!this.sessionTimeAnchor) {
			this._systemPrompt = undefined;
			return;
		}
		this._systemPrompt = buildSystemPrompt(
			this.sessionTimeAnchor,
			this.cwd,
			this._extraSystemPrompt,
			this.isSubagent,
		);
	}

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
		this.promptCachingEnabled = opts.initialPromptCachingEnabled;
		this.openaiPromptCacheRetention = opts.initialOpenAIPromptCacheRetention;
		this.googleCachedContent = opts.initialGoogleCachedContent;
		this.isSubagent = opts.isSubagent;
		this.killSubprocesses = opts.killSubprocesses;
		this.extraSystemPrompt = opts.extraSystemPrompt;
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
		// Persistence invariant: load this history via lossless JSON serialization only.
		// Model-authored messages must remain byte-for-byte equivalent in structure
		// (including providerOptions/providerMetadata thought-signature fields and
		// part ordering); do not reconstruct tool-call history on resume.

		this.sessionTimeAnchor = new Date(this.session.createdAt).toISOString();
		this.coreHistory = [...this.session.messages];
		this.rebuildSystemPrompt();
	}

	public startNewSession() {
		deleteAllSnapshots(this.session.id);
		this.session = newSession(this.currentModel, this.cwd);
		this.coreHistory.length = 0;
		this.turnIndex = 1;
		this.totalIn = 0;
		this.totalOut = 0;
		this.lastContextTokens = 0;
		this.sessionTimeAnchor = new Date(this.session.createdAt).toISOString();
		this.rebuildSystemPrompt();
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

		this.currentTurn = thisTurn;
		this.currentSnappedPaths = new Set<string>();
		const coreContent = text;

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
		if (!this._systemPrompt) {
			this.rebuildSystemPrompt();
		}
		const systemPrompt = this._systemPrompt;

		let lastAssistantText = "";

		try {
			this.snapshotStack.push(thisTurn);
			this.reporter.startSpinner("thinking");
			const events = runTurn({
				model: llm,
				modelString: this.currentModel,
				messages: this.coreHistory,
				tools: this.tools,
				...(systemPrompt ? { systemPrompt } : {}),
				signal: abortController.signal,
				pruningMode: this.pruningMode,
				toolResultPayloadCapBytes: this.toolResultPayloadCapBytes,
				promptCachingEnabled: this.promptCachingEnabled,
				openaiPromptCacheRetention: this.openaiPromptCacheRetention,
				googleCachedContent: this.googleCachedContent,
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
				// Persistence invariant: save model-authored messages with lossless JSON
				// serialization and preserve exact shape/ordering (including
				// providerOptions/providerMetadata thought-signature fields). Never
				// reconstruct tool-call history during save/load.

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
			this.currentTurn = null;
			this.currentSnappedPaths = null;
			stopWatcher();
		}
		return lastAssistantText;
	}
}
