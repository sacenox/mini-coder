import * as c from "yoctocolors";
import type { ImageAttachment } from "../cli/image-types.ts";
import { watchForInterrupt } from "../cli/input.ts";
import { getContextWindow, resolveModel } from "../llm-api/providers.ts";
import type { CoreMessage } from "../llm-api/turn.ts";
import { runTurn } from "../llm-api/turn.ts";
import type { ToolDef } from "../llm-api/types.ts";
import {
	deleteAllSnapshots,
	deleteLastTurn,
	deleteSnapshot,
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
import {
	extractAssistantText,
	makeInterruptMessage,
	resolveFileRefs,
} from "./agent-helpers.ts";
import type { AgentReporter } from "./reporter.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import { buildReadOnlyToolSet } from "./tools.ts";

export interface SessionRunnerOptions {
	cwd: string;
	reporter: AgentReporter;
	tools: ToolDef[];
	mcpTools: ToolDef[];
	initialModel: string;
	sessionId?: string | undefined;
}

export class SessionRunner {
	public cwd: string;
	public reporter: AgentReporter;
	public tools: ToolDef[];
	public mcpTools: ToolDef[];
	public currentModel: string;

	public session!: ActiveSession;
	public coreHistory!: CoreMessage[];
	public turnIndex = 1;
	public snapshotStack: Array<number | null> = [];

	public planMode = false;
	public ralphMode = false;

	public totalIn = 0;
	public totalOut = 0;
	public lastContextTokens = 0;

	constructor(opts: SessionRunnerOptions) {
		this.cwd = opts.cwd;
		this.reporter = opts.reporter;
		this.tools = opts.tools;
		this.mcpTools = opts.mcpTools;
		this.currentModel = opts.initialModel;
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
		let wasAborted = false;
		abortController.signal.addEventListener("abort", () => {
			wasAborted = true;
		});
		const stopWatcher = watchForInterrupt(abortController);

		const { text: resolvedText, images: refImages } = await resolveFileRefs(
			text,
			this.cwd,
		);
		const allImages = [...pastedImages, ...refImages];
		const thisTurn = this.turnIndex++;

		const snapped = await takeSnapshot(this.cwd, this.session.id, thisTurn);

		const coreContent = this.planMode
			? `${resolvedText}\n\n<system-message>PLAN MODE ACTIVE: Help the user gather context for the plan -- READ ONLY</system-message>`
			: this.ralphMode
				? `${resolvedText}\n\n<system-message>RALPH MODE: You are in an autonomous loop. You MUST make actual file changes (create, edit, or write files) to complete the requested task before outputting \`/ralph\`. Reading files, running tests, or exploring the codebase does NOT count as doing the work. Only output \`/ralph\` as your final message after all requested changes are implemented and tests pass.</system-message>`
				: resolvedText;

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

		if (wasAborted) {
			stopWatcher();
			const stubMsg = makeInterruptMessage("user");
			this.session.messages.push(userMsg, stubMsg);
			saveMessages(this.session.id, [userMsg, stubMsg], thisTurn);
			this.coreHistory.push(userMsg, stubMsg);
			this.snapshotStack.push(snapped ? thisTurn : null);
			touchActiveSession(this.session);
			return "";
		}

		this.session.messages.push(userMsg);
		saveMessages(this.session.id, [userMsg], thisTurn);
		this.coreHistory.push(userMsg);

		const llm = resolveModel(this.currentModel);
		const systemPrompt = buildSystemPrompt(this.cwd, this.currentModel);

		let lastAssistantText = "";
		let errorStubSaved = false;

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
			});

			const { inputTokens, outputTokens, contextTokens, newMessages } =
				await this.reporter.renderTurn(events);

			if (newMessages.length > 0) {
				this.coreHistory.push(...newMessages);
				this.session.messages.push(...newMessages);
				saveMessages(this.session.id, newMessages, thisTurn);
				if (wasAborted) {
					const note = makeInterruptMessage("user");
					this.coreHistory.push(note);
					this.session.messages.push(note);
					saveMessages(this.session.id, [note], thisTurn);
				}
			} else {
				const stubMsg = makeInterruptMessage("user");
				this.coreHistory.push(stubMsg);
				this.session.messages.push(stubMsg);
				saveMessages(this.session.id, [stubMsg], thisTurn);
			}

			lastAssistantText = extractAssistantText(newMessages);

			this.totalIn += inputTokens;
			this.totalOut += outputTokens;
			this.lastContextTokens = contextTokens;
			touchActiveSession(this.session);
		} catch (err) {
			if (!errorStubSaved) {
				errorStubSaved = true;
				const stubMsg = makeInterruptMessage("error");
				this.coreHistory.push(stubMsg);
				this.session.messages.push(stubMsg);
				saveMessages(this.session.id, [stubMsg], thisTurn);
			}
			throw err;
		} finally {
			stopWatcher();
			if (wasAborted) this.ralphMode = false;
		}

		return lastAssistantText;
	}
}
