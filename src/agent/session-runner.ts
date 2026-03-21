import * as c from "yoctocolors";
import type { ImageAttachment } from "../cli/image-types.ts";
import { watchForCancel } from "../cli/input.ts";
import type { ThinkingEffort } from "../llm-api/providers.ts";
import { resolveModel } from "../llm-api/providers.ts";
import type { CoreMessage } from "../llm-api/turn.ts";
import { runTurn } from "../llm-api/turn.ts";
import {
  applyContextPruning,
  compactToolResultPayloads,
} from "../llm-api/turn-context.ts";
import type { ToolDef } from "../llm-api/types.ts";
import { setLogContext } from "../logging/context.ts";
import { getDb, getMaxTurnIndex, saveMessages } from "../session/db/index.ts";
import { LogsRepo } from "../session/db/logs-repo.ts";
import type { ActiveSession } from "../session/manager.ts";
import {
  autoTitleSession,
  newSession,
  resumeSession,
  touchActiveSession,
} from "../session/manager.ts";
import {
  extractAssistantText,
  makeInterruptMessage,
  sanitizeModelAuthoredMessages,
} from "./agent-helpers.ts";
import type { AgentReporter } from "./reporter.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import { undoLastTurn } from "./undo-turn.ts";

interface SessionRunnerOptions {
  cwd: string;
  reporter: AgentReporter;
  tools: ToolDef[];
  mcpTools: ToolDef[];
  initialModel: string;
  initialThinkingEffort: ThinkingEffort | null;
  initialShowReasoning: boolean;
  initialVerboseOutput: boolean;
  sessionId?: string | undefined;
}

interface RunnerStatusInfo {
  model: string;
  sessionId: string;
  thinkingEffort: ThinkingEffort | null;
  totalIn: number;
  totalOut: number;
  lastContextTokens: number;
}

export class SessionRunner {
  public readonly cwd: string;
  public readonly reporter: AgentReporter;
  public readonly tools: ToolDef[];
  public readonly mcpTools: ToolDef[];

  public currentModel: string;
  public currentThinkingEffort: ThinkingEffort | null;
  public showReasoning: boolean;
  public verboseOutput: boolean;

  public session!: ActiveSession;

  private sessionTimeAnchor!: string;
  private coreHistory!: CoreMessage[];
  private turnIndex = 1;
  private totalIn = 0;
  private totalOut = 0;
  private lastContextTokens = 0;
  private _systemPrompt: string | undefined;

  constructor(opts: SessionRunnerOptions) {
    this.cwd = opts.cwd;
    this.reporter = opts.reporter;
    this.tools = opts.tools;
    this.mcpTools = opts.mcpTools;
    this.currentModel = opts.initialModel;
    this.currentThinkingEffort = opts.initialThinkingEffort;
    this.showReasoning = opts.initialShowReasoning;
    this.verboseOutput = opts.initialVerboseOutput;
    this.initSession(opts.sessionId);
  }

  public getStatusInfo(): RunnerStatusInfo {
    return {
      model: this.currentModel,
      sessionId: this.session.id,
      thinkingEffort: this.currentThinkingEffort,
      totalIn: this.totalIn,
      totalOut: this.totalOut,
      lastContextTokens: this.lastContextTokens,
    };
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
      this.reporter.info(
        `Resumed session ${this.session.id} (${c.cyan(this.currentModel)})`,
      );
    } else {
      this.session = newSession(this.currentModel, this.cwd);
    }
    this.turnIndex = getMaxTurnIndex(this.session.id) + 1;
    this.sessionTimeAnchor = new Date(this.session.createdAt).toISOString();
    this.coreHistory = [...this.session.messages];
    this.rebuildSystemPrompt();
  }

  public startNewSession() {
    this.session = newSession(this.currentModel, this.cwd);
    this.coreHistory.length = 0;
    this.turnIndex = 1;
    this.totalIn = 0;
    this.totalOut = 0;
    this.lastContextTokens = 0;
    this.sessionTimeAnchor = new Date(this.session.createdAt).toISOString();
    this.rebuildSystemPrompt();
  }

  public switchSession(id: string): boolean {
    const resumed = resumeSession(id);
    if (!resumed) return false;
    this.session = resumed;
    this.currentModel = resumed.model;
    this.coreHistory = [...resumed.messages];
    this.turnIndex = getMaxTurnIndex(resumed.id) + 1;
    this.totalIn = 0;
    this.totalOut = 0;
    this.lastContextTokens = 0;
    this.sessionTimeAnchor = new Date(resumed.createdAt).toISOString();
    this.rebuildSystemPrompt();
    return true;
  }

  public addShellContext(command: string, output: string): void {
    const thisTurn = this.turnIndex++;
    const msg: CoreMessage = {
      role: "user",
      content: `Shell output of \`${command}\`:\n\`\`\`\n${output}\n\`\`\``,
    };
    this.session.messages.push(msg);
    saveMessages(this.session.id, [msg], thisTurn);
    this.coreHistory.push(msg);
  }

  public async undoLastTurn(): Promise<boolean> {
    return undoLastTurn({
      session: this.session,
      coreHistory: this.coreHistory,
      setTurnIndex: (idx) => {
        this.turnIndex = idx;
      },
    });
  }

  public async processUserInput(
    text: string,
    pastedImages: ImageAttachment[] = [],
  ): Promise<string> {
    const abortController = new AbortController();
    const stopWatcher = watchForCancel(abortController);

    const thisTurn = this.turnIndex++;
    const userMsg: CoreMessage =
      pastedImages.length > 0
        ? {
            role: "user",
            content: [
              { type: "text", text },
              ...pastedImages.map((img) => ({
                type: "image" as const,
                image: img.data,
                mediaType: img.mediaType,
              })),
            ],
          }
        : { role: "user", content: text };

    this.session.messages.push(userMsg);
    saveMessages(this.session.id, [userMsg], thisTurn);
    this.coreHistory.push(userMsg);

    const llm = await resolveModel(this.currentModel);
    if (!this._systemPrompt) {
      this.rebuildSystemPrompt();
    }
    const systemPrompt = this._systemPrompt;

    let lastAssistantText = "";

    try {
      this.reporter.startSpinner("thinking");
      const logsRepo = new LogsRepo(getDb());
      setLogContext({ sessionId: this.session.id, logsRepo });
      try {
        const events = runTurn({
          model: llm,
          modelString: this.currentModel,
          messages: this.coreHistory,
          tools: this.tools,
          ...(systemPrompt ? { systemPrompt } : {}),
          signal: abortController.signal,
          ...(this.currentThinkingEffort
            ? { thinkingEffort: this.currentThinkingEffort }
            : {}),
        });

        const { inputTokens, outputTokens, contextTokens, newMessages } =
          await this.reporter.renderTurn(events, {
            showReasoning: this.showReasoning,
            verboseOutput: this.verboseOutput,
          });
        const historyMessages = sanitizeModelAuthoredMessages(
          newMessages,
          this.currentModel,
        );

        if (historyMessages.length > 0) {
          this.coreHistory.push(...historyMessages);
          this.session.messages.push(...historyMessages);
          saveMessages(this.session.id, historyMessages, thisTurn);
        }

        lastAssistantText = extractAssistantText(historyMessages);
        this.totalIn += inputTokens;
        this.totalOut += outputTokens;
        this.lastContextTokens = contextTokens;
        touchActiveSession(this.session);
        autoTitleSession(this.session.id, text);

        // Prune coreHistory after each turn so the next turn starts lean.
        // The DB retains the full history; this only affects in-memory context.
        this.coreHistory = compactToolResultPayloads(
          applyContextPruning(this.coreHistory),
        );
      } finally {
        setLogContext(null);
      }
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

  private rebuildSystemPrompt(): void {
    if (!this.sessionTimeAnchor) {
      this._systemPrompt = undefined;
      return;
    }
    this._systemPrompt = buildSystemPrompt(this.sessionTimeAnchor, this.cwd);
  }
}
