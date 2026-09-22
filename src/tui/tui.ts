import process from "node:process";
import type {
  Api,
  AssistantMessage,
  JsonObject,
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
import { Terminal, expandTabs, wrapLine, type Key } from "./term.ts";
import { Editor } from "./editor.ts";
import { dim } from "./styles.ts";
import { contextUsageLine, estimateContextTokens } from "./usage.ts";

export interface TuiOptions {
  models: Models;
  model: Model<Api>;
  systemPrompt: string;
  tools: Tool[];
  toolNames: ToolName[];
  thinkingEffort: ThinkingLevel;
  session: Session;
}

/** Status-row spinner frames; the only animation in the TUI. */
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_MS = 120;

/**
 * Display-only elision for tool bodies, deliberately worded differently from
 * the model-facing `... output truncated ...` marker in `tools/bash.ts`.
 */
const MAX_BODY_ROWS = 12;
const ELIDED_HEAD = 4;
const ELIDED_TAIL = 4;

const BODY_PREFIX = " | ";
const ERROR_PREFIX = " ! ";
const EXIT_LINE = /^exit code: (.+)$/;
const EDIT_HEADER = /^(Index: |={3,}$|--- |\+\+\+ )/;

/** The text after the last newline: what is still incomplete. */
function incomplete(text: string): string {
  const index = text.lastIndexOf("\n");
  return index >= 0 ? text.slice(index + 1) : text;
}

/** The lines completed by the newest text, excluding the incomplete tail. */
function completeLines(text: string): string[] {
  const lines = text.split("\n");
  lines.pop();
  return lines;
}

function callSummary(name: string, args: JsonObject): string {
  if (name === "bash" && typeof args.command === "string") return args.command.replace(/\s*\n\s*/g, " ");
  if (name === "edit" && typeof args.path === "string") return args.path;
  return JSON.stringify(args);
}

/** Display rewrite of a tool result, by tool name. */
function resultLines(name: string, text: string, isError: boolean): string[] {
  const lines = text.trimEnd().split("\n");
  if (name === "bash") {
    const exit = EXIT_LINE.exec(lines[lines.length - 1]);
    if (exit !== null) {
      lines.pop();
      if (isError) lines.push(`exit ${exit[1]}`);
    }
  } else if (name === "edit" && /^(edited|created) /.test(lines[0])) {
    lines.shift();
    // The call line already names the path; drop the repeated diff file header.
    while (lines.length > 0 && EDIT_HEADER.test(lines[0])) lines.shift();
  }
  return lines;
}

function bodyRows(lines: string[], width: number): string[] {
  const rows = lines.flatMap((line) => wrapLine(expandTabs(line), width));
  if (rows.length > MAX_BODY_ROWS) {
    const hidden = rows.length - ELIDED_HEAD - ELIDED_TAIL;
    return [
      ...rows.slice(0, ELIDED_HEAD),
      `... ${hidden} lines not shown ...`,
      ...rows.slice(rows.length - ELIDED_TAIL),
    ];
  }
  return rows;
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

  /** `lines` are already styled; the live region adds no attributes of its own. */
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
  private phase: Phase = "idle";
  private detail: string | undefined;
  private active = false;
  private paused = false;
  private pauseRequested = false;
  private steeringResolve: ((text: string) => void) | null = null;
  private abort: AbortController | null = null;
  private renderScheduled = false;
  private reanchor = false;
  private closed = false;

  // Scrollback: lines accumulate here and are written above the live region.
  private scroll = "";
  private wrote = false;
  private lastBlank = false;
  private separator = false;

  // In-flight stream state, never persisted: all display-only.
  private pending = "";
  private preview = "";
  private pendingCalls: string[] = [];
  private streamed = "";
  private turnStart = 0;
  private frame = 0;
  private spinner: NodeJS.Timeout | undefined;

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
    this.separator = true;
    this.push(
      `mini-coder · ${this.opts.model.provider}/${this.opts.model.id} · ` +
        "Enter submit · Ctrl+J newline · Esc pause · Ctrl+C cancel · Ctrl+D exit",
    );
    this.separator = true;
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
    this.phase = "preparing";
    this.detail = undefined;
    this.turnStart = Date.now();
    this.frame = 0;
    this.spinner = setInterval(() => {
      this.frame++;
      this.render();
    }, SPINNER_MS);
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
      this.separator = true;
      this.push(`! ${(error as Error).message}`);
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
      if (this.spinner) clearInterval(this.spinner);
      this.spinner = undefined;
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
    this.render();
  }

  private handleAgentEvent(event: AgentEvent): void {
    if (this.closed) return;
    switch (event.type) {
      case "phase":
        this.phase = event.phase;
        this.detail = event.detail;
        if (event.phase === "pausing") this.paused = true;
        break;
      case "text":
        this.preview = "";
        this.pending += event.delta;
        this.streamed += event.delta;
        for (const line of completeLines(this.pending)) this.push(line);
        this.pending = incomplete(this.pending);
        break;
      case "reasoning":
        if (this.pending === "") this.preview = incomplete(this.preview + event.delta);
        break;
      case "toolCall":
        // Flush first so scrollback order matches execution order, then hold the
        // call line until its result arrives: a message may carry several calls,
        // all announced before any of them runs.
        this.flushPending();
        this.preview = "";
        this.pendingCalls.push(`-> ${event.name}  ${callSummary(event.name, event.arguments)}`);
        break;
      case "toolOutput":
        this.preview = incomplete(this.preview + event.chunk);
        break;
      case "message":
        this.commitMessage(event.message);
        break;
      case "toolResult":
        this.preview = "";
        this.commitToolResult(event.name, event.text, event.isError);
        break;
      case "error":
        this.finishTurn();
        this.flushPending();
        this.flushCalls();
        this.separator = true;
        this.push(`! ${event.message}`);
        break;
      case "cancelled":
        this.finishTurn();
        this.flushPending();
        this.flushCalls();
        this.separator = true;
        this.push("! cancelled");
        break;
      case "complete":
        this.finishTurn();
        this.flushPending();
        this.flushCalls();
        this.separator = true;
        this.push(dim(`[complete · ${this.elapsed()}s]`));
        break;
    }
    this.render();
  }

  /** Terminal states clear the status row instead of lingering in it. */
  private finishTurn(): void {
    this.phase = "idle";
    this.detail = undefined;
    this.paused = false;
  }

  private elapsed(): number {
    return Math.max(0, Math.floor((Date.now() - this.turnStart) / 1000));
  }

  private commitUser(text: string): void {
    this.separator = true;
    for (const line of text.split("\n")) this.push(`> ${line}`);
    this.separator = true;
  }

  /** Commits a line the model emitted without streaming it, plus the in-flight tail. */
  private commitMessage(message: AssistantMessage): void {
    this.preview = "";
    this.flushPending();
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (text.trim() !== "" && !this.streamed.includes(text)) {
      for (const line of text.trimEnd().split("\n")) this.push(line);
    }
    this.streamed = "";
  }

  private commitToolResult(name: string, text: string, isError: boolean): void {
    const call = this.pendingCalls.shift();
    this.separator = true;
    if (call !== undefined) this.push(call);
    const width = Math.max(1, this.term.width - BODY_PREFIX.length);
    const rows = bodyRows(resultLines(name, text, isError), width);
    for (let i = 0; i < rows.length; i++) {
      const prefix = isError && i === rows.length - 1 ? ERROR_PREFIX : BODY_PREFIX;
      this.push(prefix + rows[i]);
    }
    this.separator = true;
  }

  /** Commits any call line whose result never arrived, e.g. after a cancel. */
  private flushCalls(): void {
    for (const call of this.pendingCalls) {
      this.separator = true;
      this.push(call);
    }
    this.pendingCalls = [];
  }

  private flushPending(): void {
    if (this.pending === "") return;
    const line = this.pending;
    this.pending = "";
    this.push(line);
  }

  /**
   * Appends one scrollback line. A block boundary owes exactly one blank line,
   * and two blank lines never appear in a row.
   */
  private push(line: string): void {
    const blank = line === "" || (this.separator && this.wrote);
    this.separator = false;
    if (blank && this.wrote && !this.lastBlank) {
      this.scroll += "\n";
      this.lastBlank = true;
    }
    if (line !== "") {
      this.scroll += `${line}\n`;
      this.wrote = true;
      this.lastBlank = false;
    }
    this.flushScroll();
  }

  /** Scrollback is written before the live region is redrawn, never after. */
  private flushScroll(): void {
    if (this.scroll === "") return;
    const out = this.live.clear() + this.scroll;
    this.scroll = "";
    this.term.write(out);
  }

  private render(): void {
    if (this.closed || this.renderScheduled) return;
    this.renderScheduled = true;
    setTimeout(() => {
      this.renderScheduled = false;
      this.draw();
    }, 16);
  }

  /** One dim row while a turn is active or paused; nothing when idle. */
  private statusLine(): string | null {
    if (this.paused || this.phase === "pausing") return "paused - type steering, Enter to continue";
    if (!this.active || this.phase === "idle") return null;
    const label =
      this.phase === "preparing"
        ? "preparing"
        : this.phase === "waitingModel"
          ? "waiting for provider"
          : this.phase === "streaming"
            ? "streaming"
            : `running ${this.detail ?? "tool"}`;
    return `${SPINNER[this.frame % SPINNER.length]} ${label} · ${this.elapsed()}s`;
  }

  private draw(): void {
    if (this.closed) return;
    const width = Math.max(1, this.term.width);
    const lines: string[] = [];
    lines.push(
      contextUsageLine(
        estimateContextTokens(this.messages, this.opts.systemPrompt, this.opts.tools),
        this.opts.model,
      ),
    );
    const pending = this.pending !== "" ? this.pending : this.preview;
    if (pending !== "") {
      const styled = this.pending === "" ? dim : (row: string) => row;
      for (const row of wrapLine(expandTabs(pending), width)) lines.push(styled(row));
    }
    const status = this.statusLine();
    if (status !== null) lines.push(dim(status));
    const editor = this.editor.render(width);
    const editorStart = lines.length;
    lines.push(...editor.rows);

    let cursorRow = editorStart + editor.cursorRow;
    let cursorCol = editor.cursorCol;
    let shown = lines;
    const maxRows = Math.max(1, this.term.height - 1);
    if (lines.length > maxRows) {
      const dropped = lines.length - maxRows;
      shown = lines.slice(dropped);
      cursorRow -= dropped;
      if (cursorRow < 0) {
        cursorRow = 0;
        cursorCol = 0;
      }
    }
    if (cursorRow >= shown.length) cursorRow = shown.length - 1;
    const prefix = this.reanchor ? "\r\n" : "";
    this.reanchor = false;
    this.term.write(prefix + this.live.draw(shown, cursorRow, cursorCol));
  }

  private exit(): void {
    if (this.closed) return;
    this.closed = true;
    this.abort?.abort();
    if (this.spinner) clearInterval(this.spinner);
    this.spinner = undefined;
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
