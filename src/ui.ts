/**
 * Terminal UI for mini-coder.
 *
 * Owns the cel-tui lifecycle (init/stop), renders the conversation log,
 * input area, animated divider, and status bar. Wires user input to the
 * agent loop and streams events back to the UI.
 *
 * @module
 */

import { spawn } from "node:child_process";
import { platform } from "node:os";
import { Select } from "@cel-tui/components";
import {
  cel,
  HStack,
  measureContentHeight,
  ProcessTerminal,
  Text,
  VStack,
} from "@cel-tui/core";
import type { Node } from "@cel-tui/types";
import type { AppState } from "./index.ts";
import { reloadPromptContext, shutdown } from "./index.ts";
import { collapseWhitespaceToNull, joinTextBlocks } from "./text.ts";
import type { Theme } from "./theme.ts";
import { createUiAgentController } from "./ui/agent.ts";
import { createCommandController } from "./ui/commands.ts";
import {
  buildConversationLogNodes,
  CONVERSATION_GAP,
  resetConversationRenderCache,
} from "./ui/conversation.ts";
import type { InputController } from "./ui/input.ts";
import {
  autocompleteInputPath,
  findInputPathMatches,
  renderInputArea as renderInputAreaNode,
} from "./ui/input.ts";
import {
  type ActiveOverlay,
  OVERLAY_MAX_VISIBLE,
  renderOverlay,
} from "./ui/overlay.ts";
import { createUiRuntimeHelpers } from "./ui/runtime.ts";
import { renderStatusBar } from "./ui/status.ts";

export type { InputController } from "./ui/input.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Divider animation speed (ms per frame). */
const DIVIDER_FRAME_MS = 60;

/** Width of the bright pulse segment in the animated divider. */
const PULSE_WIDTH = 5;

/** Number of trailing words shown in the idle terminal-title preview. */
const TERMINAL_TITLE_WORD_COUNT = 5;

/** Divider ticks spent on each animated terminal-title scanner frame. */
const TERMINAL_TITLE_TICKS_PER_FRAME = 4;

/** Frames used for the active terminal-title glow-scanner animation. */
const TERMINAL_TITLE_FRAMES = [
  "[=o---]",
  "[-=o--]",
  "[--=o-]",
  "[---=o]",
  "[--o=-]",
  "[-o=--]",
  "[o=---]",
] as const;

/** Maximum number of committed messages rendered before older history is chunked. */
const CONVERSATION_CHUNK_MESSAGES = 50;

/** Centralized interactive quit rules for keypresses and submitted input. */
const QUIT_RULES: Readonly<{
  /** Submitted raw inputs that trigger graceful quit. */
  inputs: ReadonlySet<string>;
  /** Keypresses that always trigger graceful quit. */
  keysAlways: ReadonlySet<string>;
  /** Keypresses that trigger graceful quit only when input is empty. */
  keysWhenEmptyInput: ReadonlySet<string>;
}> = {
  inputs: new Set([":q"]),
  keysAlways: new Set(["ctrl+c"]),
  keysWhenEmptyInput: new Set(["ctrl+d"]),
};

// ---------------------------------------------------------------------------
// UI state (module-scoped, not in AppState)
// ---------------------------------------------------------------------------

/** Scroll position for the conversation log. */
let scrollOffset = 0;

/** Whether the log auto-scrolls to the bottom. */
let stickToBottom = true;

/** First visible committed message when older history is chunked. */
let visibleConversationStart = 0;

/** Current text in the input area. */
let inputValue = "";

/** Whether the text input is focused. */
let inputFocused = true;

/** Animated divider frame counter. */
let dividerTick = 0;

/** Divider animation timer handle. */
let dividerTimer: ReturnType<typeof setInterval> | null = null;

/** Whether stdin was already in raw mode before the TUI initialized. */
let stdinWasRaw = false;

/** Latest application state associated with the active terminal UI. */
let titleState: AppState | null = null;

/** Whether a cel viewport has rendered for the current UI session. */
let titleViewportActive = false;

/** Last terminal title written during the current UI session. */
let lastTerminalTitle: string | null = null;

// ---------------------------------------------------------------------------
// Overlay state
// ---------------------------------------------------------------------------

/** Active overlay for interactive commands (/model, /effort, etc.). */
let activeOverlay: ActiveOverlay | null = null;

/** Determine whether a raw input line should trigger a graceful quit. */
export function isQuitInput(raw: string): boolean {
  const trimmed = raw.trim();
  return QUIT_RULES.inputs.has(trimmed);
}

/** Determine whether a keypress should trigger a graceful quit. */
export function isQuitKey(key: string, input: string): boolean {
  if (QUIT_RULES.keysAlways.has(key)) {
    return true;
  }
  if (input === "" && QUIT_RULES.keysWhenEmptyInput.has(key)) {
    return true;
  }
  return false;
}

/**
 * Reset all module-scoped UI state.
 *
 * Useful for reinitializing the UI and for keeping tests isolated.
 */
export function resetUiState(): void {
  scrollOffset = 0;
  stickToBottom = true;
  visibleConversationStart = 0;
  inputValue = "";
  inputFocused = true;
  dividerTick = 0;
  stopDividerAnimation();
  agentController.reset();
  resetConversationRenderCache();
  activeOverlay = null;
  stdinWasRaw = false;
  titleState = null;
  titleViewportActive = false;
  lastTerminalTitle = null;
}

// ---------------------------------------------------------------------------
// Terminal title
// ---------------------------------------------------------------------------

function getUserTerminalTitleText(
  content: Extract<AppState["messages"][number], { role: "user" }>["content"],
): string | null {
  if (typeof content === "string") {
    return collapseWhitespaceToNull(content);
  }

  return collapseWhitespaceToNull(joinTextBlocks(content));
}

function getAssistantTerminalTitleText(
  content: Extract<
    AppState["messages"][number],
    { role: "assistant" }
  >["content"],
): string | null {
  return collapseWhitespaceToNull(joinTextBlocks(content));
}

function truncateTerminalTitleTail(text: string): string {
  const words = text.split(" ");
  if (words.length <= TERMINAL_TITLE_WORD_COUNT) {
    return text;
  }
  return `...${words.slice(-TERMINAL_TITLE_WORD_COUNT).join(" ")}`;
}

function buildIdleTerminalTitle(state: Pick<AppState, "messages">): string {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (!message) {
      continue;
    }

    let text: string | null = null;
    switch (message.role) {
      case "user":
        text = getUserTerminalTitleText(message.content);
        break;
      case "assistant":
        text = getAssistantTerminalTitleText(message.content);
        break;
      case "toolResult":
      case "ui":
        break;
    }

    if (text) {
      return `mc - ${truncateTerminalTitleTail(text)}`;
    }
  }

  return "mc";
}

/**
 * Build the current terminal title from UI state.
 *
 * Idle titles show a short tail preview from the latest conversational text
 * message. Active turns show a stable-width glow scanner.
 *
 * @param state - Application state needed to derive the title.
 * @param animationTick - Divider animation tick used to pick the scanner frame.
 * @returns The terminal title text to write via cel-tui.
 */
export function buildTerminalTitle(
  state: Pick<AppState, "messages" | "running">,
  animationTick = dividerTick,
): string {
  if (!state.running) {
    return buildIdleTerminalTitle(state);
  }

  const frameIndex =
    Math.floor(animationTick / TERMINAL_TITLE_TICKS_PER_FRAME) %
    TERMINAL_TITLE_FRAMES.length;
  return `mc - ${TERMINAL_TITLE_FRAMES[frameIndex]}`;
}

function syncTerminalTitle(
  state: Pick<AppState, "messages" | "running"> | null,
): void {
  if (!state || !titleViewportActive) {
    return;
  }

  const title = buildTerminalTitle(state);
  if (title === lastTerminalTitle) {
    return;
  }

  cel.setTitle(title);
  lastTerminalTitle = title;
}

function invalidateTerminalTitleCache(): void {
  lastTerminalTitle = null;
}

function requestRender(): void {
  syncTerminalTitle(titleState);
  cel.render();
}

// ---------------------------------------------------------------------------
// Divider animation
// ---------------------------------------------------------------------------

/** Start the scanning pulse animation on the divider. */
function startDividerAnimation(): void {
  stopDividerAnimation();
  dividerTick = 0;
  dividerTimer = setInterval(() => {
    dividerTick++;
    requestRender();
  }, DIVIDER_FRAME_MS);
}

/** Stop the divider animation. */
function stopDividerAnimation(): void {
  if (dividerTimer) {
    clearInterval(dividerTimer);
    dividerTimer = null;
  }
}

/**
 * Render the animated divider.
 *
 * When the agent is working, a bright segment sweeps across the dimmed
 * line. When idle, it's a static dimmed line.
 */
function renderDivider(state: AppState, width: number): Node {
  if (!state.running) {
    return Text("─", { repeat: "fill", fgColor: state.theme.divider });
  }

  const total = Math.max(width, 1);
  const pos = dividerTick % (total + PULSE_WIDTH);
  const pulseStart = Math.max(0, pos - PULSE_WIDTH);
  const pulseEnd = Math.min(pos, total);
  const pulseLen = pulseEnd - pulseStart;
  const beforeLen = pulseStart;
  const afterLen = total - pulseEnd;

  const segments: Node[] = [];
  if (beforeLen > 0) {
    segments.push(
      Text("─", { repeat: beforeLen, fgColor: state.theme.divider }),
    );
  }
  if (pulseLen > 0) {
    segments.push(
      Text("═", {
        repeat: pulseLen,
        fgColor: state.theme.dividerPulse,
      }),
    );
  }
  if (afterLen > 0) {
    segments.push(
      Text("─", { repeat: afterLen, fgColor: state.theme.divider }),
    );
  }

  return HStack({ height: 1 }, segments);
}

// ---------------------------------------------------------------------------
// Conversation log
// ---------------------------------------------------------------------------

function getLatestConversationChunkStart(messageCount: number): number {
  return Math.max(0, messageCount - CONVERSATION_CHUNK_MESSAGES);
}

function getVisibleConversationStart(messageCount: number): number {
  if (stickToBottom) {
    return getLatestConversationChunkStart(messageCount);
  }

  visibleConversationStart = Math.min(
    visibleConversationStart,
    getLatestConversationChunkStart(messageCount),
  );
  return visibleConversationStart;
}

/** Build the full conversation log as an array of nodes. */
export function buildConversationLog(
  state: AppState,
  width = Number.POSITIVE_INFINITY,
): Node[] {
  return buildConversationLogNodes(
    state,
    agentController.getStreamingConversationState(),
    getVisibleConversationStart(state.messages.length),
    width,
  );
}

function measureConversationHeight(
  state: AppState,
  width: number,
  startIndex: number,
): number {
  return measureContentHeight(
    VStack(
      { gap: CONVERSATION_GAP },
      buildConversationLogNodes(
        state,
        agentController.getStreamingConversationState(),
        startIndex,
        width,
      ),
    ),
    { width: Math.max(1, width) },
  );
}

function prependConversationChunk(state: AppState, width: number): void {
  const currentStart = visibleConversationStart;
  const nextStart = Math.max(0, currentStart - CONVERSATION_CHUNK_MESSAGES);
  const currentHeight = measureConversationHeight(state, width, currentStart);
  const nextHeight = measureConversationHeight(state, width, nextStart);

  visibleConversationStart = nextStart;
  scrollOffset += Math.max(0, nextHeight - currentHeight);
}

// ---------------------------------------------------------------------------
// Overlay rendering
// ---------------------------------------------------------------------------

/** Open an overlay and move focus away from the input. */
function openOverlay(overlay: ActiveOverlay): void {
  activeOverlay = overlay;
  inputFocused = false;
  requestRender();
}

/** Dismiss the active overlay and return focus to the input. */
function dismissOverlay(): void {
  activeOverlay = null;
  inputFocused = true;
  requestRender();
}

function openPathAutocompleteOverlay(state: AppState): void {
  const matches = findInputPathMatches(inputValue, state.cwd);
  if (matches.length <= 1) {
    return;
  }

  const select = Select({
    items: matches.map((match) => ({
      label: match.label,
      value: match.value,
      filterText: match.label,
    })),
    maxVisible: OVERLAY_MAX_VISIBLE,
    placeholder: "type to filter paths...",
    focused: true,
    highlightColor: state.theme.accentText,
    onSelect: (value) => {
      inputValue = value;
      dismissOverlay();
    },
    onBlur: dismissOverlay,
  });

  openOverlay({ select, title: "Path matches" });
}

function handleTabKeyPress(state: AppState): void {
  if (inputValue.startsWith("/")) {
    commandController.showCommandAutocomplete(state);
    return;
  }

  const completedInput = autocompleteInputPath(inputValue, state.cwd);
  if (completedInput) {
    inputValue = completedInput;
    requestRender();
    return;
  }

  openPathAutocompleteOverlay(state);
}

/**
 * Render the active overlay when one is open.
 *
 * @param state - Application state.
 * @returns The rendered overlay node, or `null` when no overlay is active.
 */
export function renderActiveOverlay(state: AppState): Node | null {
  if (!activeOverlay) {
    return null;
  }
  return renderOverlay(state.theme, activeOverlay);
}

// ---------------------------------------------------------------------------
// Input area
// ---------------------------------------------------------------------------

/**
 * Create stable handlers for the main TextInput.
 *
 * cel-tui keys TextInput cursor/scroll state by the `onChange` function
 * reference, so these callbacks must be created once and reused across
 * renders.
 *
 * @param state - Application state used by the handlers.
 * @returns Stable callbacks for the controlled TextInput.
 */
export function createInputController(state: AppState): InputController {
  titleState = state;

  return {
    onChange: (value) => {
      inputValue = value;
      requestRender();
    },
    onFocus: () => {
      inputFocused = true;
      requestRender();
    },
    onBlur: () => {
      inputFocused = false;
      requestRender();
    },
    onKeyPress: (key) => {
      if (key === "enter") {
        const raw = inputValue;

        if (isQuitInput(raw)) {
          inputValue = "";
          requestRender();
          requestGracefulExit(state);
          return false;
        }

        inputValue = "";
        requestRender();
        handleInput(raw, state);
        return false;
      }
      if (key === "tab") {
        handleTabKeyPress(state);
        return false;
      }
    },
  };
}

/**
 * Render the input area.
 *
 * @param theme - Active UI theme.
 * @param controller - Stable TextInput callbacks.
 * @returns The input area node.
 */
export function renderInputArea(
  theme: Theme,
  controller: InputController,
): Node {
  return renderInputAreaNode(theme, controller, inputValue, inputFocused);
}

// ---------------------------------------------------------------------------
// Runtime helpers and controllers
// ---------------------------------------------------------------------------

/** Browser process handle used by the platform opener helper. */
interface BrowserOpenProcess {
  /** Detach the browser opener so the app does not wait on it. */
  unref: () => void;
  /** Optional error listener used by real child-process implementations. */
  on?: (event: "error", listener: (error: Error) => void) => void;
}

/** Optional runtime overrides for browser launching. */
interface OpenInBrowserRuntime {
  /** Platform used to choose the opener binary. */
  platform?: NodeJS.Platform;
  /** Process launcher used for tests. */
  spawn?: (
    command: string,
    args: string[],
    options: { detached: boolean; stdio: "ignore" },
  ) => BrowserOpenProcess;
}

/** Open a URL in the user's default browser without invoking a shell. */
export function openInBrowser(
  url: string,
  runtime?: OpenInBrowserRuntime,
): void {
  const command =
    (runtime?.platform ?? platform()) === "darwin" ? "open" : "xdg-open";
  const launch =
    runtime?.spawn ??
    ((
      cmd: string,
      args: string[],
      options: { detached: boolean; stdio: "ignore" },
    ) => {
      return spawn(cmd, args, options);
    });
  const child = launch(command, [url], {
    detached: true,
    stdio: "ignore",
  });

  child.on?.("error", () => {});
  child.unref();
}

function scrollConversationToBottom(): void {
  stickToBottom = true;
}

const uiRuntimeHelpers = createUiRuntimeHelpers({
  render: requestRender,
  scrollConversationToBottom,
});

/** Command controller bound to the module-scoped UI runtime hooks. */
const commandController = createCommandController({
  openOverlay,
  dismissOverlay,
  setInputValue: (value) => {
    inputValue = value;
  },
  appendInfoMessage: uiRuntimeHelpers.appendInfoMessage,
  appendTodoMessage: uiRuntimeHelpers.appendTodoMessage,
  scrollConversationToBottom,
  render: requestRender,
  reloadPromptContext,
  openInBrowser,
});

// ---------------------------------------------------------------------------
// Agent loop wiring
// ---------------------------------------------------------------------------

/** Agent controller bound to the module-scoped UI runtime hooks. */
const agentController = createUiAgentController({
  appendInfoMessage: uiRuntimeHelpers.appendInfoMessage,
  handleCommand: (command, state) =>
    commandController.handleCommand(command, state),
  render: requestRender,
  scrollConversationToBottom,
  startDividerAnimation,
  stopDividerAnimation,
});

/** Route raw user input through parseInput and dispatch accordingly. */
export function handleInput(raw: string, state: AppState): void {
  titleState = state;
  agentController.handleInput(raw, state);
}

// ---------------------------------------------------------------------------
// Graceful exit
// ---------------------------------------------------------------------------

/** Shut down cleanly and exit. */
async function gracefulExit(state: AppState): Promise<void> {
  stopDividerAnimation();
  if (state.abortController) state.abortController.abort();
  cel.stop();
  await shutdown(state);
  process.exit(0);
}

/** Request a graceful exit and hard-fail if shutdown errors. */
function requestGracefulExit(state: AppState): void {
  gracefulExit(state).catch(() => process.exit(1));
}

/** Restore the terminal to the shell before suspending. */
function suspendTerminalUi(): void {
  stopDividerAnimation();
  process.stdout.write("\x1b[?1006l\x1b[?1000l");
  process.stdout.write("\x1b[<u");
  process.stdout.write("\x1b[?25h");
  process.stdout.write("\x1b[?1049l");
  process.stdin.pause();
  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(stdinWasRaw);
  }
}

/** Re-enter the TUI terminal modes after a suspended process is resumed. */
function resumeTerminalUi(): void {
  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdout.write("\x1b[?1049h");
  process.stdout.write("\x1b[>1u");
  process.stdout.write("\x1b[?1000h\x1b[?1006h");
  process.stdout.write("\x1b[?25l");
}

/** Suspend the app to the background and restore the UI on SIGCONT. */
export function suspendToBackground(
  resumeUi: () => void,
  runtime?: {
    stop?: () => void;
    onResume?: (resume: () => void) => void;
    suspend?: () => void;
  },
): void {
  const stop = runtime?.stop ?? suspendTerminalUi;
  const onResume =
    runtime?.onResume ??
    ((resume: () => void) => {
      process.once("SIGCONT", resume);
    });
  const suspend =
    runtime?.suspend ??
    (() => {
      process.kill(process.pid, "SIGTSTP");
    });
  const keepAlive = setInterval(() => {}, 1 << 30);

  stop();
  onResume(() => {
    clearInterval(keepAlive);
    invalidateTerminalTitleCache();
    resumeUi();
  });

  try {
    suspend();
  } catch (error) {
    clearInterval(keepAlive);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function renderConversationLog(state: AppState, width: number): Node {
  return VStack(
    {
      flex: 1,
      gap: CONVERSATION_GAP,
      overflow: "scroll",
      justifyContent: state.messages.length === 0 ? "center" : undefined,
      scrollOffset: stickToBottom ? Infinity : scrollOffset,
      onScroll: (offset, maxOffset) => {
        const wasStickToBottom = stickToBottom;
        scrollOffset = offset;

        if (wasStickToBottom && offset < maxOffset) {
          visibleConversationStart = getLatestConversationChunkStart(
            state.messages.length,
          );
        }

        stickToBottom = offset >= maxOffset;

        if (!stickToBottom && offset === 0 && visibleConversationStart > 0) {
          prependConversationChunk(state, width);
        }

        requestRender();
      },
    },
    buildConversationLog(state, width),
  );
}

/**
 * Render the base application layout without overlays.
 *
 * The layout contains the conversation log, the animated divider, the input
 * area, and the one-line pill-based status bar.
 *
 * @param state - Application state.
 * @param cols - Current terminal width in columns.
 * @param inputController - Stable callbacks for the controlled TextInput.
 * @returns The base layout node.
 */
export function renderBaseLayout(
  state: AppState,
  cols: number,
  inputController: InputController,
  onSuspend?: () => void,
): Node {
  titleState = state;
  titleViewportActive = true;
  if (lastTerminalTitle === null) {
    syncTerminalTitle(state);
  }

  return VStack(
    {
      height: "100%",
      onKeyPress: (key) => {
        if (key === "ctrl+r") {
          commandController.showInputHistoryOverlay(state);
          return;
        }
        if (isQuitKey(key, inputValue)) {
          requestGracefulExit(state);
          return;
        }
        if (key === "ctrl+z") {
          onSuspend?.();
          return;
        }
        if (key === "escape") {
          if (state.running) {
            inputFocused = true;
            if (state.abortController) {
              state.abortController.abort();
            }
          }
          return;
        }
        return false;
      },
    },
    [
      // ── Conversation log ──
      renderConversationLog(state, cols),

      // ── Animated divider (pulse when agent is working) ──
      renderDivider(state, cols),

      // ── Input area ──
      renderInputArea(state.theme, inputController),

      // ── Status bar (1 line) ──
      renderStatusBar(state, cols),
    ],
  );
}

/**
 * Start the terminal UI.
 *
 * Initializes cel-tui, sets up the viewport, and takes over the terminal.
 * Does not return until the user exits.
 *
 * @param state - The initialized application state from {@link init}.
 */
export function startUI(state: AppState): void {
  resetUiState();
  stdinWasRaw = process.stdin.isRaw || false;
  titleState = state;
  const terminal = new ProcessTerminal();
  const inputController = createInputController(state);
  cel.init(terminal);

  cel.viewport(() => {
    const cols = terminal.columns;
    const base = renderBaseLayout(state, cols, inputController, () => {
      suspendToBackground(() => {
        resumeTerminalUi();
        cel._getBuffer()?.clear();
        if (state.running) {
          startDividerAnimation();
        }
        requestRender();
      });
    });
    const overlay = renderActiveOverlay(state);

    if (overlay) {
      return [base, overlay];
    }
    return base;
  });
  syncTerminalTitle(state);

  if (state.running) {
    startDividerAnimation();
  }

  // Show warnings from custom provider discovery
  for (const warning of state.startupWarnings) {
    uiRuntimeHelpers.appendInfoMessage(warning, state);
  }
}
