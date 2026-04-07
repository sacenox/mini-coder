/**
 * Terminal UI for mini-coder.
 *
 * Owns the cel-tui lifecycle (init/stop), renders the conversation log,
 * input area, animated divider, and status bar. Wires user input to the
 * agent loop and streams events back to the UI.
 *
 * @module
 */

import { exec } from "node:child_process";
import { platform } from "node:os";
import { cel, HStack, ProcessTerminal, Text, VStack } from "@cel-tui/core";
import type { Node } from "@cel-tui/types";
import type { AppState } from "./index.ts";
import { MAX_SESSIONS_PER_CWD, shutdown } from "./index.ts";
import {
  appendMessage,
  createSession,
  createUiMessage,
  truncateSessions,
} from "./session.ts";
import type { Theme } from "./theme.ts";
import {
  createUiAgentController,
  getStreamingConversationState,
  resetUiAgentState,
} from "./ui/agent.ts";
import { createCommandController } from "./ui/commands.ts";
import { buildConversationLogNodes } from "./ui/conversation.ts";
import type { InputController } from "./ui/input.ts";
import {
  autocompleteInputPath,
  renderInputArea as renderInputAreaNode,
} from "./ui/input.ts";
import { type ActiveOverlay, renderOverlay } from "./ui/overlay.ts";
import { renderStatusBar } from "./ui/status.ts";

export {
  applyEffortSelection,
  applyModelSelection,
  formatPromptHistoryPreview,
  formatRelativeDate,
} from "./ui/commands.ts";
export {
  type ConversationRenderOpts,
  type PendingToolCall,
  previewToolRenderLines,
  renderAssistantMessage,
  renderToolResult,
  type ToolRenderLine,
  type ToolRenderLineKind,
} from "./ui/conversation.ts";
export { buildHelpText, type HelpRenderState } from "./ui/help.ts";
export type { InputController } from "./ui/input.ts";
export { renderStatusBar } from "./ui/status.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Divider animation speed (ms per frame). */
const DIVIDER_FRAME_MS = 60;

/** Width of the bright pulse segment in the animated divider. */
const PULSE_WIDTH = 5;

// ---------------------------------------------------------------------------
// UI state (module-scoped, not in AppState)
// ---------------------------------------------------------------------------

/** Scroll position for the conversation log. */
let scrollOffset = 0;

/** Whether the log auto-scrolls to the bottom. */
let stickToBottom = true;

/** Current text in the input area. */
let inputValue = "";

/** Whether the text input is focused. */
let inputFocused = true;

/** Animated divider frame counter. */
let dividerTick = 0;

/** Divider animation timer handle. */
let dividerTimer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Overlay state
// ---------------------------------------------------------------------------

/** Active overlay for interactive commands (/model, /effort, etc.). */
let activeOverlay: ActiveOverlay | null = null;

/**
 * Reset all module-scoped UI state.
 *
 * Useful for reinitializing the UI and for keeping tests isolated.
 */
export function resetUiState(): void {
  scrollOffset = 0;
  stickToBottom = true;
  inputValue = "";
  inputFocused = true;
  dividerTick = 0;
  stopDividerAnimation();
  resetUiAgentState();
  activeOverlay = null;
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
    cel.render();
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

/** Build the full conversation log as an array of nodes. */
export function buildConversationLog(state: AppState): Node[] {
  return buildConversationLogNodes(state, getStreamingConversationState());
}

// ---------------------------------------------------------------------------
// Overlay rendering
// ---------------------------------------------------------------------------

/** Open an overlay and move focus away from the input. */
function openOverlay(overlay: ActiveOverlay): void {
  activeOverlay = overlay;
  inputFocused = false;
  cel.render();
}

/** Dismiss the active overlay and return focus to the input. */
function dismissOverlay(): void {
  activeOverlay = null;
  inputFocused = true;
  cel.render();
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
  return {
    onChange: (value) => {
      inputValue = value;
      cel.render();
    },
    onFocus: () => {
      inputFocused = true;
      cel.render();
    },
    onBlur: () => {
      inputFocused = false;
      cel.render();
    },
    onKeyPress: (key) => {
      if (key === "enter") {
        const raw = inputValue;
        inputValue = "";
        cel.render();
        handleInput(raw, state);
        return false;
      }
      if (key === "tab") {
        if (inputValue.startsWith("/")) {
          commandController.showCommandAutocomplete(state);
        } else {
          const completedInput = autocompleteInputPath(inputValue, state.cwd);
          if (completedInput) {
            inputValue = completedInput;
            cel.render();
          }
        }
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

/** Open a URL in the user's default browser. */
function openInBrowser(url: string): void {
  const cmd = platform() === "darwin" ? "open" : "xdg-open";
  exec(`${cmd} ${JSON.stringify(url)}`);
}

/**
 * Ensure the app has an active persisted session.
 *
 * Creates the session lazily on the first user message and backfills any
 * pre-session UI messages currently shown in the log.
 *
 * @param state - Application state.
 * @returns The active persisted session.
 */
function ensureSession(state: AppState): NonNullable<AppState["session"]> {
  if (state.session) {
    return state.session;
  }

  const modelLabel = state.model
    ? `${state.model.provider}/${state.model.id}`
    : undefined;
  const session = createSession(state.db, {
    cwd: state.canonicalCwd,
    model: modelLabel,
    effort: state.effort,
  });
  truncateSessions(state.db, state.canonicalCwd, MAX_SESSIONS_PER_CWD);
  state.session = session;

  for (const message of state.messages) {
    appendMessage(state.db, session.id, message);
  }

  return session;
}

/**
 * Append a UI-only info message to the conversation log.
 *
 * When no persisted session exists yet, the message stays in memory and is
 * backfilled if the user later starts a session by sending a message.
 *
 * @param text - Display text to append.
 * @param state - Application state.
 */
function appendInfoMessage(text: string, state: AppState): void {
  const msg = createUiMessage(text);
  if (state.session) {
    appendMessage(state.db, state.session.id, msg);
  }
  state.messages.push(msg);
  stickToBottom = true;
  cel.render();
}

/** Command controller bound to the module-scoped UI runtime hooks. */
const commandController = createCommandController({
  openOverlay,
  dismissOverlay,
  setInputValue: (value) => {
    inputValue = value;
  },
  appendInfoMessage,
  scrollConversationToBottom: () => {
    stickToBottom = true;
  },
  render: () => {
    cel.render();
  },
  openInBrowser,
});

// ---------------------------------------------------------------------------
// Agent loop wiring
// ---------------------------------------------------------------------------

/** Agent controller bound to the module-scoped UI runtime hooks. */
const agentController = createUiAgentController({
  ensureSession,
  appendInfoMessage,
  handleCommand: (command, state) =>
    commandController.handleCommand(command, state),
  render: () => {
    cel.render();
  },
  scrollConversationToBottom: () => {
    stickToBottom = true;
  },
  startDividerAnimation,
  stopDividerAnimation,
});

/** Route raw user input through parseInput and dispatch accordingly. */
export function handleInput(raw: string, state: AppState): void {
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function renderConversationLog(state: AppState): Node {
  return VStack(
    {
      flex: 1,
      overflow: "scroll",
      scrollbar: true,
      scrollOffset: stickToBottom ? Infinity : scrollOffset,
      onScroll: (offset, maxOffset) => {
        scrollOffset = offset;
        stickToBottom = offset >= maxOffset;
        cel.render();
      },
    },
    buildConversationLog(state),
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
): Node {
  return VStack(
    {
      height: "100%",
      onKeyPress: (key) => {
        if (key === "ctrl+r") {
          commandController.showInputHistoryOverlay(state);
          return;
        }
        if (key === "ctrl+c") {
          gracefulExit(state).catch(() => process.exit(1));
          return;
        }
        if (key === "ctrl+d" && inputValue === "") {
          gracefulExit(state).catch(() => process.exit(1));
          return;
        }
        if (key === "escape" && state.running) {
          if (state.abortController) state.abortController.abort();
          return;
        }
        return false;
      },
    },
    [
      // ── Conversation log ──
      renderConversationLog(state),

      // ── Animated divider (pulse when agent is working) ──
      renderDivider(state, cols),

      // ── Input area ──
      renderInputArea(state.theme, inputController),

      // ── Status bar (1 line) ──
      renderStatusBar(state),
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
  const terminal = new ProcessTerminal();
  const inputController = createInputController(state);
  cel.init(terminal);

  cel.viewport(() => {
    const cols = terminal.columns;
    const base = renderBaseLayout(state, cols, inputController);
    const overlay = renderActiveOverlay(state);

    if (overlay) {
      return [base, overlay];
    }
    return base;
  });
}
