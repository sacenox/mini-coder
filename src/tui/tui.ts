import process from "node:process";
import type {
  Api,
  AssistantMessage,
  Message,
  Model,
  Models,
  ThinkingLevel,
  Tool,
  UserMessage,
} from "@earendil-works/pi-ai";
import { runAgentTurn, type AgentEvent, type Phase } from "../agent.ts";
import type { Session } from "../session.ts";
import type { ToolName } from "../config.ts";
import { Terminal, wrapLine, type Key } from "./term.ts";
import { Editor } from "./editor.ts";

export interface TuiOptions {
  models: Models;
  model: Model<Api>;
  systemPrompt: string;
  tools: Tool[];
  toolNames: ToolName[];
  thinkingEffort: ThinkingLevel;
  session: Session;
}

const MAX_LIVE_ROWS = 8;
const MAX_LIVE_CHARS = 4000;

function wrapText(text: string, width: number): string[] {
  return text.split("\n").flatMap((line) => wrapLine(line, width));
}

function tail(text: string): string {
  return text.length > MAX_LIVE_CHARS ? text.slice(text.length - MAX_LIVE_CHARS) : text;
}

function phaseStatus(phase: Phase, detail?: string): string {
  switch (phase) {
    case "preparing":
      return "preparing";
    case "waitingModel":
      return "waiting for provider";
    case "streaming":
      return "streaming";
    case "runningTool":
      return `running ${detail ?? "tool"}`;
    case "pausing":
      return "paused — type steering, Enter to continue";
    case "idle":
      return "ready";
  }
}

class LiveRegion {
  private rows = 0;
  private cursorUp = 0;

  reset(): void {
    this.rows = 0;
    this.cursorUp = 0;
  }

  clear(): string {
    if (this.rows === 0) return "";
    let out = "";
    if (this.cursorUp > 0) out += `\x1b[${this.cursorUp}B`;
    if (this.rows > 1) out += `\x1b[${this.rows - 1}A`;
    out += "\r\x1b[J";
    this.rows = 0;
    this.cursorUp = 0;
    return out;
  }

  draw(lines: string[], cursorRow: number, cursorCol: number): string {
    let out = this.clear();
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) out += "\r\n";
      out += lines[i];
    }
    const up = lines.length - 1 - cursorRow;
    if (up > 0) out += `\x1b[${up}A`;
    out += "\r";
    if (cursorCol > 0) out += `\x1b[${cursorCol + 1}G`;
    this.rows = lines.length;
    this.cursorUp = up;
    return out;
  }
}

class Tui {
  private readonly opts: TuiOptions;
  private readonly term: Terminal;
  private readonly editor = new Editor();
  private readonly live = new LiveRegion();
  private readonly messages: Message[] = [];
  readonly done: Promise<void>;

  private resolveExit: () => void = () => {};
  private status = "ready";
  private reasoning = "";
  private answer = "";
  private toolOutput = "";
  private active = false;
  private paused = false;
  private pauseRequested = false;
  private steeringResolve: ((text: string) => void) | null = null;
  private abort: AbortController | null = null;
  private renderScheduled = false;
  private reanchor = false;
  private closed = false;

  constructor(opts: TuiOptions) {
    this.opts = opts;
    this.term = new Terminal({
      onKey: (key) => this.handleKey(key),
      onResize: () => this.handleResize(),
    });
    this.done = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
  }

  start(): void {
    this.term.start();
    process.on("SIGINT", this.onSignal);
    process.on("SIGTERM", this.onSignal);
    this.commit(
      `mini-coder · ${this.opts.model.provider}/${this.opts.model.id} · ` +
        "Enter submit · Ctrl+J newline · Esc pause · Ctrl+C cancel · Ctrl+D exit",
    );
    this.render();
  }

  private onSignal = (): void => {
    this.exit();
  };

  private handleResize(): void {
    // Reflow invalidates cursor-relative coordinates. Drop the anchor instead
    // of guessing and never erase committed history.
    this.live.reset();
    this.reanchor = true;
    this.render();
  }

  private handleKey(key: Key): void {
    if (key.type === "eof") {
      if (!this.active && this.editor.text() === "") this.exit();
      return;
    }
    if (key.type === "interrupt") {
      if (this.active) this.cancel();
      else if (this.editor.text() !== "") {
        this.editor.clear();
        this.render();
      }
      return;
    }
    if (key.type === "escape") {
      if (this.active && !this.paused) {
        this.pauseRequested = true;
        this.status = "pause requested";
        this.render();
      }
      return;
    }
    const result = this.editor.handle(key);
    if (result === "submit") this.submit();
    else if (result === "changed") this.render();
  }

  private submit(): void {
    const text = this.editor.text();
    if (this.active) {
      if (this.paused && this.steeringResolve) {
        this.editor.clear();
        if (text.length > 0) this.commitUser(text);
        const resolve = this.steeringResolve;
        this.steeringResolve = null;
        this.paused = false;
        resolve(text);
      }
      return;
    }
    if (text.trim() === "") return;
    this.editor.clear();
    const message: UserMessage = { role: "user", content: text, timestamp: Date.now() };
    this.messages.push(message);
    this.opts.session.appendMessage(message);
    this.commitUser(text);
    this.startTurn();
  }

  private startTurn(): void {
    this.active = true;
    this.abort = new AbortController();
    this.status = "preparing";
    void this.runTurn();
    this.render();
  }

  private async runTurn(): Promise<void> {
    try {
      await runAgentTurn({
        models: this.opts.models,
        model: this.opts.model,
        systemPrompt: this.opts.systemPrompt,
        tools: this.opts.tools,
        toolNames: this.opts.toolNames,
        messages: this.messages,
        session: this.opts.session,
        signal: this.abort!.signal,
        thinkingEffort: this.opts.thinkingEffort,
        interaction: {
          isPauseRequested: () => this.pauseRequested,
          clearPause: () => {
            this.pauseRequested = false;
          },
          requestSteering: () =>
            new Promise<string>((resolve) => {
              this.paused = true;
              this.steeringResolve = (text) => {
                this.paused = false;
                this.steeringResolve = null;
                resolve(text);
              };
              this.render();
            }),
        },
        onEvent: (event) => this.handleAgentEvent(event),
      });
    } catch (error) {
      this.status = "failed";
      this.commit(`! ${(error as Error).message}`);
    } finally {
      this.active = false;
      this.abort = null;
      this.pauseRequested = false;
      if (this.steeringResolve) {
        const resolve = this.steeringResolve;
        this.steeringResolve = null;
        resolve("");
      }
      this.paused = false;
      this.render();
    }
  }

  private cancel(): void {
    if (this.steeringResolve) {
      const resolve = this.steeringResolve;
      this.steeringResolve = null;
      this.paused = false;
      resolve("");
    }
    this.abort?.abort();
    this.status = "cancelling";
    this.render();
  }

  private handleAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case "phase":
        this.status = phaseStatus(event.phase, event.detail);
        if (event.phase === "pausing") this.paused = true;
        break;
      case "text":
        this.answer = tail(this.answer + event.delta);
        break;
      case "reasoning":
        this.reasoning = tail(this.reasoning + event.delta);
        break;
      case "toolCall":
        break;
      case "toolOutput":
        this.toolOutput = tail(this.toolOutput + event.chunk);
        break;
      case "message":
        this.commitAssistant(event.message);
        this.answer = "";
        this.reasoning = "";
        break;
      case "toolResult":
        this.commitToolResult(event.text, event.isError);
        this.toolOutput = "";
        break;
      case "error":
        this.status = "failed";
        this.commit(`! ${event.message}`);
        break;
      case "cancelled":
        this.status = "cancelled";
        this.commit("! cancelled");
        break;
      case "complete":
        this.status = "complete";
        break;
    }
    this.render();
  }

  private commitUser(text: string): void {
    this.commit(
      text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n"),
    );
  }

  private commitAssistant(message: AssistantMessage): void {
    const parts: string[] = [];
    for (const block of message.content) {
      if (block.type === "thinking") {
        if (block.thinking.trim()) parts.push(block.thinking.trimEnd());
      } else if (block.type === "text") {
        if (block.text.trim()) parts.push(block.text.trimEnd());
      } else if (block.type === "toolCall") {
        parts.push(`→ ${block.name} ${JSON.stringify(block.arguments)}`);
      }
    }
    if (parts.length > 0) this.commit(parts.join("\n"));
  }

  private commitToolResult(text: string, isError: boolean): void {
    const body = text.trimEnd();
    if (body === "") return;
    this.commit(isError ? `! ${body}` : body);
  }

  private commit(text: string): void {
    if (text === "") return;
    let out = this.live.clear();
    out += text.endsWith("\n") ? text : `${text}\n`;
    this.term.write(out);
    this.render();
  }

  private render(): void {
    if (this.closed || this.renderScheduled) return;
    this.renderScheduled = true;
    setTimeout(() => {
      this.renderScheduled = false;
      this.draw();
    }, 16);
  }

  private draw(): void {
    if (this.closed) return;
    const width = Math.max(1, this.term.width);
    const maxLive = Math.max(1, Math.min(MAX_LIVE_ROWS, this.term.height - 1));
    const content: string[] = [];
    if (this.reasoning) content.push(...wrapText(this.reasoning, width));
    if (this.answer) content.push(...wrapText(this.answer, width));
    if (this.toolOutput) content.push(...wrapText(this.toolOutput, width));
    const status = wrapText(`[${this.status}]`, width);
    const editor = this.editor.render(width);
    const all = [...content, ...status, ...editor.rows];
    const shown = all.slice(-maxLive);
    const editorOffset = all.length - editor.rows.length;
    const shownOffset = all.length - shown.length;
    let cursorRow = editorOffset + editor.cursorRow - shownOffset;
    let cursorCol = editor.cursorCol;
    if (cursorRow < 0) {
      cursorRow = 0;
      cursorCol = 0;
    }
    if (cursorRow >= shown.length) cursorRow = shown.length - 1;
    const prefix = this.reanchor ? "\r\n" : "";
    this.reanchor = false;
    this.term.write(prefix + this.live.draw(shown, cursorRow, cursorCol));
  }

  private exit(): void {
    if (this.closed) return;
    this.closed = true;
    this.term.write(this.live.clear());
    this.term.stop();
    this.opts.session.close();
    process.off("SIGINT", this.onSignal);
    process.off("SIGTERM", this.onSignal);
    this.resolveExit();
  }
}

export async function runTui(opts: TuiOptions): Promise<void> {
  const tui = new Tui(opts);
  tui.start();
  return tui.done;
}
