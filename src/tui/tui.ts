import process from "node:process";
import type { AssistantMessage, JsonObject, Message, UserMessage } from "@earendil-works/pi-ai";
import { runAgentTurn, type AgentEvent, type AgentOptions, type Phase } from "../agent.ts";
import { Terminal, expandTabs, sanitize, wrapLine, type Key } from "./term.ts";
import { Editor } from "./editor.ts";
import { completeCommand, findCommand, type CommandContext } from "./commands.ts";
import { MarkdownStream, TailStream, type BodyLine, type StreamRenderer } from "./stream.ts";
import { blue, cyan, dim, green, red, teal } from "./styles.ts";
import { DIFF_ADD, DIFF_DELETE, NORMAL_BG, sgrBg, sgrPlain } from "./theme.ts";
import { contextUsageLine, estimateContextTokens } from "./usage.ts";

/** Status-row spinner frames; the only animation in the TUI. */
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_MS = 120;

/**
 * Display-only elision for tool bodies, deliberately worded differently from
 * the model-facing `... output truncated ...` marker in `tools/bash.ts`.
 * `edit` is exempt: its diffs are always shown in full.
 */
const MAX_BODY_ROWS = 12;
const ELIDED_HEAD = 4;
const ELIDED_TAIL = 4;

const BODY_PREFIX = " | ";
const ERROR_PREFIX = " ! ";
/** The chrome prefix, styled: dim for output, red for errors; text stays `Normal`. */
const BODY_CHROME = dim(BODY_PREFIX);
const ERROR_CHROME = red(ERROR_PREFIX);
const EXIT_LINE = /^exit code: (.+)$/;
const EDIT_HEADER = /^(Index: |={3,}$|--- |\+\+\+ )/;

/** The `-> <name>` head of a call line, in the tool accent; the args stay `Normal`. */
function callHead(name: string): string {
  return teal(`-> ${name}`);
}

function callSummary(name: string, args: JsonObject): string {
  if (name === "bash" && typeof args.command === "string") return args.command.replace(/\s*\n\s*/g, " ");
  if ((name === "edit" || name === "read") && typeof args.path === "string") return args.path;
  return JSON.stringify(args);
}

/**
 * Unified-diff styling for one `edit` body line; file headers are stripped.
 * Additions and deletions carry the `DiffAdd`/`DiffDelete` background, so every
 * cell of the line — the trailing ones `paintRow` erases included — is tinted.
 */
function diffLine(line: string): BodyLine {
  if (line.startsWith("@@")) return { text: line, style: cyan };
  if (line.startsWith("+")) return { text: line, style: green, bg: DIFF_ADD };
  if (line.startsWith("-")) return { text: line, style: red, bg: DIFF_DELETE };
  if (line.startsWith("\\ No newline")) return { text: line, style: dim };
  if (line.startsWith(" ")) return { text: line, style: dim };
  return { text: line };
}

/** Display rewrite of a tool result, by tool name. */
function resultLines(name: string, text: string, isError: boolean): BodyLine[] {
  const lines = text.trimEnd().split("\n");
  let diff = false;
  if (name === "bash") {
    const exit = EXIT_LINE.exec(lines[lines.length - 1]);
    if (exit !== null) {
      lines.pop();
      if (isError) lines.push(red(`exit ${exit[1]}`));
    }
  } else if (name === "edit" && /^(edited|created) /.test(lines[0])) {
    lines.shift();
    // The call line already names the path; drop the repeated diff file header.
    while (lines.length > 0 && EDIT_HEADER.test(lines[0])) lines.shift();
    diff = true;
  }
  return lines.map((line) => (diff ? diffLine(line) : { text: line }));
}

/**
 * Wraps plain text, then styles each row: styling after the break is what lets a
 * continuation row inherit its source line's style. A continuation row carries
 * no marker; empty rows stay unstyled.
 */
function renderRows(lines: BodyLine[], width: number): string[] {
  return lines.flatMap((line) => {
    const { style, bg } = line;
    const wrapped = wrapLine(expandTabs(sanitize(line.text)), width);
    return wrapped.map((row) => {
      if (row === "") return row;
      const styled = style === undefined ? row : style(row);
      // The row's own background opens and closes it. A markdown span that
      // carries a background (a heading tint, inline code) can still be open
      // where the row ends, and `paintRow`'s trailing erase fills with whatever
      // background is current — so the row has to hand it back its own.
      const rowBg = sgrBg(bg ?? NORMAL_BG);
      return `${rowBg}${styled}${rowBg}`;
    });
  });
}

/**
 * Paints one written row: the palette's pair, the row's own styling, then
 * `ESC[K` — erase to the end of the line, which the terminal does *with the
 * row's current background*. The row's trailing cells take the row's own
 * background (the diff tints included) without a glyph being written for them,
 * so a short row has no cell left to the host. Padding with spaces would look
 * the same, but a terminal that reflows on a narrower resize would then wrap
 * every row and lose the live region's anchor.
 */
function paintRow(line: string): string {
  return `${sgrPlain()}${line}\x1b[K`;
}

/** `renderRows` plus the display-only elision applied to long tool bodies. */
function bodyRows(lines: BodyLine[], width: number): string[] {
  const rows = renderRows(lines, width);
  if (rows.length > MAX_BODY_ROWS) {
    const hidden = rows.length - ELIDED_HEAD - ELIDED_TAIL;
    return [
      ...rows.slice(0, ELIDED_HEAD),
      dim(`... ${hidden} lines not shown ...`),
      ...rows.slice(rows.length - ELIDED_TAIL),
    ];
  }
  return rows;
}

class LiveRegion {
  private rows = 0;
  private cursorUp = 0;

  /** Rows the region currently occupies on screen. */
  get height(): number {
    return this.rows;
  }

  clear(): string {
    if (this.rows === 0) return "";
    let out = "";
    if (this.cursorUp > 0) out += `\x1b[${this.cursorUp}B`;
    if (this.rows > 1) out += `\x1b[${this.rows - 1}A`;
    // `ESC[J` erases with the *current* background, so the palette's is set
    // first: without it the erase bites host-coloured holes and the region
    // flashes the terminal's background while typing.
    out += `\r${sgrPlain()}\x1b[J`;
    this.rows = 0;
    this.cursorUp = 0;
    return out;
  }

  /**
   * `lines` are already styled; the live region adds no attributes of its own.
   * `above` is written between the clear and the body, so scrollback lands
   * where the region was.
   */
  draw(lines: string[], cursorRow: number, cursorCol: number, above: string): string {
    let out = this.clear();
    out += above;
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
  private readonly opts: AgentOptions;
  private readonly term: Terminal;
  private readonly editor = new Editor();
  private readonly live = new LiveRegion();
  private readonly messages: Message[] = [];
  readonly done: Promise<void>;

  /** The only capability a command gets: styled lines into scrollback. */
  private readonly commandContext: CommandContext = {
    write: (lines) => {
      this.separator = true;
      this.commitLines(lines.map((text) => ({ text })));
      this.separator = true;
    },
  };

  private resolveExit: () => void = () => {};
  private phase: Phase = "idle";
  private detail: string | undefined;
  private writingTool: string | undefined;
  private active = false;
  private paused = false;
  private pauseRequested = false;
  private steeringResolve: ((text: string) => void) | null = null;
  private abort: AbortController | null = null;
  private renderScheduled = false;
  private closed = false;

  // Scrollback: lines accumulate here and are written above the live region.
  private scroll = "";
  private wrote = false;
  private lastBlank = false;
  private separator = false;

  // In-flight stream state, never persisted: all display-only.
  private readonly reply: StreamRenderer = new MarkdownStream();
  private readonly activity: StreamRenderer = new TailStream();
  private streamed = "";
  private turnStart = 0;
  private frame = 0;
  private spinner: NodeJS.Timeout | undefined;

  constructor(opts: AgentOptions) {
    this.opts = opts;
    this.term = new Terminal({
      onKey: (key) => this.handleKey(key),
      // A reflow moves the region but leaves the cursor on the line it was on,
      // so the region's top is still `cursorUp` rows above it. Redraw over the
      // old region instead of dropping the anchor, which would leave it behind.
      onResize: () => this.render(),
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
    this.push(`mini-coder · ${this.opts.model.provider}/${this.opts.model.id} · ${this.opts.thinkingEffort}`);
    this.separator = true;
    this.render();
  }

  private onSignal = (): void => this.exit();

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
    if (key.type === "tab") {
      const completed = completeCommand(this.editor.text());
      if (completed !== null) {
        this.editor.setText(completed);
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
      if (this.paused && this.steeringResolve !== null) {
        this.editor.clear();
        if (text.length > 0) this.commitUser(text);
        this.resolveSteering(text);
      }
      return;
    }
    if (text.trim() === "") return;
    const invocation = findCommand(text);
    if (invocation !== null) {
      this.editor.clear();
      invocation.command.run(this.commandContext, invocation.args);
      this.render();
      return;
    }
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
        ...this.opts,
        messages: this.messages,
        signal: this.abort!.signal,
        interaction: {
          isPauseRequested: () => this.pauseRequested,
          clearPause: () => {
            this.pauseRequested = false;
          },
          requestSteering: () =>
            new Promise<string>((resolve) => {
              this.paused = true;
              this.steeringResolve = resolve;
              this.render();
            }),
        },
        onEvent: (event) => this.handleAgentEvent(event),
      });
    } catch (error) {
      this.separator = true;
      this.push(red(`! ${(error as Error).message}`));
    } finally {
      this.active = false;
      this.abort = null;
      this.pauseRequested = false;
      this.resolveSteering("");
      this.paused = false;
      if (this.spinner) clearInterval(this.spinner);
      this.spinner = undefined;
      this.render();
    }
  }

  private cancel(): void {
    this.resolveSteering("");
    this.abort?.abort();
    this.render();
  }

  /** Answers a pending steering prompt; "" leaves the turn ending. */
  private resolveSteering(text: string): void {
    const resolve = this.steeringResolve;
    if (resolve === null) return;
    this.steeringResolve = null;
    this.paused = false;
    resolve(text);
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
        this.activity.reset();
        this.streamed += event.delta;
        this.commitLines(this.reply.feed(event.delta));
        break;
      case "reasoning":
        if (this.reply.pending().length === 0) this.activity.feed(event.delta);
        break;
      case "toolCall":
        // Flush first so scrollback order matches execution order, then commit
        // the call line: results land under the calls, in execution order.
        this.writingTool = undefined;
        this.commitLines(this.reply.flush());
        this.activity.reset();
        this.commitCall(event.name, event.arguments);
        break;
      case "toolCallStart":
        this.writingTool = event.name;
        break;
      case "toolOutput":
        this.activity.feed(event.chunk);
        break;
      case "message":
        this.commitMessage(event.message);
        break;
      case "toolResult":
        this.activity.reset();
        this.commitToolResult(event.name, event.text, event.isError);
        break;
      case "error":
        this.endTurn(red(`! ${event.message}`));
        break;
      case "cancelled":
        this.endTurn(red("! cancelled"));
        break;
      case "complete":
        this.endTurn(dim(`[complete · ${this.elapsed()}s]`));
        break;
    }
    this.render();
  }

  /** A terminal state: clears the status row and any in-flight preview, then commits. */
  private endTurn(line: string): void {
    this.phase = "idle";
    this.detail = undefined;
    this.writingTool = undefined;
    this.paused = false;
    this.activity.reset();
    this.commitLines(this.reply.flush());
    this.separator = true;
    this.push(line);
  }

  private elapsed(): number {
    return Math.max(0, Math.floor((Date.now() - this.turnStart) / 1000));
  }

  private commitUser(text: string): void {
    this.separator = true;
    this.commitLines(text.split("\n").map((line) => ({ text: line, style: blue })));
    this.separator = true;
  }

  /** The call line lands the moment the model finishes writing it, never held. */
  private commitCall(name: string, args: JsonObject): void {
    this.separator = true;
    this.commitLines([{ text: `${callHead(name)}  ${callSummary(name, args)}` }]);
  }

  /** Commits a line the model emitted without streaming it, plus the in-flight tail. */
  private commitMessage(message: AssistantMessage): void {
    this.activity.reset();
    this.commitLines(this.reply.flush());
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (text.trim() !== "" && !this.streamed.includes(text)) {
      const stream = new MarkdownStream();
      this.commitLines([...stream.feed(text.trimEnd()), ...stream.flush()]);
    }
    this.streamed = "";
  }

  private commitToolResult(name: string, text: string, isError: boolean): void {
    const width = Math.max(1, this.term.width - BODY_PREFIX.length);
    const lines = resultLines(name, text, isError);
    // Diffs are shown in full; other tool bodies stay elided.
    const rows = name === "edit" ? renderRows(lines, width) : bodyRows(lines, width);
    for (let i = 0; i < rows.length; i++) {
      const prefix = isError && i === rows.length - 1 ? ERROR_CHROME : BODY_CHROME;
      this.push(prefix + rows[i]);
    }
    this.separator = true;
  }

  /** Commits logical lines through the same wrap-and-style step tool bodies use. */
  private commitLines(lines: BodyLine[]): void {
    for (const row of renderRows(lines, Math.max(1, this.term.width))) this.push(row);
  }

  /**
   * Appends one scrollback line. A block boundary owes exactly one blank line,
   * and two blank lines never appear in a row.
   */
  private push(line: string): void {
    line = sanitize(line);
    const blank = line === "" || (this.separator && this.wrote);
    this.separator = false;
    if (blank && this.wrote && !this.lastBlank) {
      // A separator is a row the app occupies, so it is painted like any other:
      // a bare newline would leave the host terminal showing through it.
      this.scroll += `${paintRow("")}\r\n`;
      this.lastBlank = true;
    }
    if (line !== "") {
      this.scroll += `${paintRow(line)}\r\n`;
      this.wrote = true;
      this.lastBlank = false;
    }
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

  /**
   * The one row between the in-flight lines and the editor: the phase while a
   * turn is active, and the context readout always. The readout carries its own
   * emphasis, so only the phase half is dimmed.
   */
  private statusLine(): string {
    const usage = contextUsageLine(
      estimateContextTokens(this.messages, this.opts.systemPrompt, this.opts.tools),
      this.opts.model,
    );
    if (this.paused || this.phase === "pausing") {
      return `${dim("paused - type steering, Enter to submit")} · ${usage}`;
    }
    if (!this.active || this.phase === "idle") return usage;
    const label =
      this.phase === "preparing"
        ? "preparing"
        : this.phase === "waitingModel"
          ? "waiting for provider"
          : this.phase === "streaming"
            ? this.writingTool !== undefined
              ? `writing ${this.writingTool}`
              : "streaming"
            : `running ${this.detail ?? "tool"}`;
    return `${dim(`${SPINNER[this.frame % SPINNER.length]} ${label} · ${this.elapsed()}s`)} · ${usage}`;
  }

  private draw(): void {
    if (this.closed) return;
    const width = Math.max(1, this.term.width);
    const height = Math.max(1, this.term.height - 1);

    const status = wrapLine(this.statusLine(), width);

    let inflight = this.reply.pending();
    if (inflight.length === 0) inflight = this.activity.pending();
    const rows = renderRows(inflight, width);

    // Short on space: clip the in-flight rows first, then the editor viewport,
    // which never drops below one row. The status rows are always kept.
    const keep = Math.max(0, Math.min(rows.length, height - status.length - 1));
    const body = rows.slice(rows.length - keep);
    const editor = this.editor.render(width, Math.max(1, height - status.length - body.length));

    const lines = [...body, ...status, ...editor.rows].map(paintRow);
    let cursorRow = status.length + body.length + editor.cursorRow;
    if (cursorRow >= lines.length) cursorRow = lines.length - 1;

    // Scrollback and the live region are written as one frame. Clearing the
    // region and restoring it in separate writes leaves it blank in between.
    // A commit on a region filling every row above the last scrolls the
    // terminal; the re-anchor newline goes after the scrollback, not before the
    // erase, because `clear()` measures from the previous frame's cursor and
    // moving the cursor down first lands the erase one row below the region.
    const scroll = this.scroll;
    this.scroll = "";
    const reanchor = scroll !== "" && this.live.height >= this.term.height - 1;
    this.term.write(this.live.draw(lines, cursorRow, editor.cursorCol, scroll + (reanchor ? "\r\n" : "")));
  }

  private exit(): void {
    if (this.closed) return;
    this.closed = true;
    this.abort?.abort();
    if (this.spinner) clearInterval(this.spinner);
    this.spinner = undefined;
    // Draws are deferred, so anything pushed since the last frame is still here.
    this.term.write(this.live.clear() + this.scroll);
    this.scroll = "";
    this.term.stop();
    this.opts.session.close();
    process.off("SIGINT", this.onSignal);
    process.off("SIGTERM", this.onSignal);
    this.resolveExit();
  }
}

export async function runTui(opts: AgentOptions): Promise<void> {
  const tui = new Tui(opts);
  tui.start();
  return tui.done;
}
