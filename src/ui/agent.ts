/**
 * Input parsing, message submission, and streaming agent-event handling for the terminal UI.
 *
 * This module owns the transient streaming render state for the in-progress
 * assistant response. Persistent session and message state remain on
 * {@link AppState}; transient UI concerns are exposed through runtime hooks so
 * `ui.ts` can stay a small orchestrator.
 *
 * @module
 */

import { readFileSync } from "node:fs";
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from "@mariozechner/pi-ai";
import type { AgentEvent } from "../agent.ts";
import { runAgentLoop } from "../agent.ts";
import { getGitState } from "../git.ts";
import type { AppState } from "../index.ts";
import { buildPrompt, buildToolList, MAX_PROMPT_HISTORY } from "../index.ts";
import { parseInput } from "../input.ts";
import {
  addMessageToStats,
  appendMessage,
  appendPromptHistory,
  filterModelMessages,
  truncatePromptHistory,
} from "../session.ts";
import { executeReadImage } from "../tools.ts";
import type {
  PendingToolResult,
  StreamingConversationState,
} from "./conversation.ts";

/** Streaming assistant content for the current response. */
let streamingContent: AssistantMessage["content"] = [];

/** Whether a response is currently streaming. */
let isStreaming = false;

/** Tool results collected during the current streaming turn. */
let pendingToolResults: PendingToolResult[] = [];

/** Hooks implemented by `ui.ts` to bridge controller logic with runtime UI state. */
interface UiAgentRuntime {
  /** Ensure a persisted session exists for the active conversation. */
  ensureSession: (state: AppState) => NonNullable<AppState["session"]>;
  /** Append a UI-only informational message to the conversation log. */
  appendInfoMessage: (text: string, state: AppState) => void;
  /** Dispatch a parsed slash command. */
  handleCommand: (command: string, state: AppState) => boolean;
  /** Trigger a UI render. */
  render: () => void;
  /** Re-enable stick-to-bottom behavior for the conversation log. */
  scrollConversationToBottom: () => void;
  /** Start the active-turn divider animation. */
  startDividerAnimation: () => void;
  /** Stop the active-turn divider animation. */
  stopDividerAnimation: () => void;
}

/** Public controller API for raw input dispatch and streaming state. */
interface UiAgentController {
  /** Route raw user input through parseInput and dispatch accordingly. */
  handleInput: (raw: string, state: AppState) => void;
}

/**
 * Reset the transient streaming UI state owned by this module.
 *
 * Used by `resetUiState()` and tests to keep state isolated.
 */
export function resetUiAgentState(): void {
  streamingContent = [];
  isStreaming = false;
  pendingToolResults = [];
}

/**
 * Read the current streaming tail state for conversation rendering.
 *
 * @returns The in-progress assistant content and pending tool results.
 */
export function getStreamingConversationState(): StreamingConversationState {
  return {
    isStreaming,
    content: streamingContent,
    pendingToolResults,
  };
}

/**
 * Strip YAML frontmatter from a skill file.
 *
 * @param content - Raw `SKILL.md` file content.
 * @returns The content without a leading frontmatter block.
 */
export function stripSkillFrontmatter(content: string): string {
  const frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return frontmatter ? content.slice(frontmatter[0].length) : content;
}

/**
 * Check whether user content contains any meaningful model-visible payload.
 *
 * @param content - User message content to inspect.
 * @returns `true` when the content is empty or whitespace-only.
 */
export function isEmptyUserContent(content: UserMessage["content"]): boolean {
  if (typeof content === "string") {
    return content.trim().length === 0;
  }

  return content.every(
    (block) => block.type === "text" && block.text.trim().length === 0,
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Create the UI agent controller bound to runtime hooks supplied by `ui.ts`.
 *
 * @param runtime - Runtime hooks for rendering, scrolling, and session creation.
 * @returns The controller used by the input layer and tests.
 */
export function createUiAgentController(
  runtime: UiAgentRuntime,
): UiAgentController {
  const buildSkillMessageContent = (
    skillName: string,
    userText: string,
    state: AppState,
  ): string | null => {
    const skill = state.skills.find((entry) => entry.name === skillName);
    if (!skill) {
      runtime.appendInfoMessage(`Unknown skill: ${skillName}`, state);
      return null;
    }

    let skillBody: string;
    try {
      skillBody = stripSkillFrontmatter(
        readFileSync(skill.path, "utf-8"),
      ).trim();
    } catch (err) {
      runtime.appendInfoMessage(
        `Failed to read skill ${skillName}: ${getErrorMessage(err)}`,
        state,
      );
      return null;
    }

    const parts = [skillBody, userText].filter((part) => part.length > 0);
    return parts.length > 0 ? parts.join("\n\n") : null;
  };

  const buildImageMessageContent = (
    imagePath: string,
    rawInput: string,
    state: AppState,
  ): UserMessage["content"] | null => {
    const displayPath = rawInput.trim();

    try {
      const result = executeReadImage({ path: imagePath }, state.cwd);
      if (result.isError) {
        return displayPath || null;
      }

      return [
        { type: "text", text: displayPath },
        ...result.content.filter((block) => block.type === "image"),
      ];
    } catch {
      return displayPath || null;
    }
  };

  const submitMessage = async (
    content: UserMessage["content"],
    state: AppState,
    rawInput: string,
  ): Promise<void> => {
    if (isEmptyUserContent(content) || !state.model || state.running) {
      return;
    }

    const session = runtime.ensureSession(state);
    appendPromptHistory(state.db, {
      text: rawInput,
      cwd: state.cwd,
      sessionId: session.id,
    });
    truncatePromptHistory(state.db, MAX_PROMPT_HISTORY);

    const userMessage: Message = {
      role: "user",
      content,
      timestamp: Date.now(),
    };

    const turn = appendMessage(state.db, session.id, userMessage);
    state.messages.push(userMessage);
    runtime.scrollConversationToBottom();
    runtime.render();

    state.git = await getGitState(state.cwd);

    const systemPrompt = buildPrompt(state);
    const { tools, toolHandlers } = buildToolList(state);

    state.running = true;
    state.abortController = new AbortController();
    isStreaming = true;
    streamingContent = [];
    pendingToolResults = [];
    runtime.startDividerAnimation();
    runtime.render();

    try {
      await runAgentLoop({
        db: state.db,
        sessionId: session.id,
        turn,
        model: state.model,
        systemPrompt,
        tools,
        toolHandlers,
        messages: filterModelMessages(state.messages),
        cwd: state.cwd,
        apiKey: state.providers.get(state.model.provider),
        effort: state.effort,
        signal: state.abortController.signal,
        onEvent: (event) => handleAgentEvent(event, state),
      });
      state.git = await getGitState(state.cwd);
    } finally {
      state.running = false;
      state.abortController = null;
      resetUiAgentState();
      runtime.stopDividerAnimation();
      runtime.render();
    }
  };

  const submitMessageAsync = (
    content: UserMessage["content"],
    state: AppState,
    rawInput: string,
  ): void => {
    let submitPromise: Promise<void>;
    submitPromise = submitMessage(content, state, rawInput)
      .catch((err) => {
        runtime.appendInfoMessage(
          `Submit failed: ${getErrorMessage(err)}`,
          state,
        );
      })
      .finally(() => {
        if (state.activeTurnPromise === submitPromise) {
          state.activeTurnPromise = null;
        }
      });

    state.activeTurnPromise = submitPromise;
  };

  const handleAgentEvent = (event: AgentEvent, state: AppState): void => {
    switch (event.type) {
      case "text_delta":
      case "thinking_delta":
      case "toolcall_start":
      case "toolcall_delta":
      case "toolcall_end":
        streamingContent = event.content;
        runtime.render();
        break;

      case "assistant_message":
        state.messages.push(event.message);
        state.stats = addMessageToStats(state.stats, event.message);
        streamingContent = [];
        runtime.render();
        break;

      case "tool_start":
        break;

      case "tool_delta":
      case "tool_end": {
        const pending = pendingToolResults.find(
          (toolResult) => toolResult.toolCallId === event.toolCallId,
        );
        if (pending) {
          pending.toolName = event.name;
          pending.content = event.result.content;
          pending.isError = event.result.isError;
        } else {
          pendingToolResults.push({
            toolCallId: event.toolCallId,
            toolName: event.name,
            content: event.result.content,
            isError: event.result.isError,
          });
        }
        runtime.render();
        break;
      }

      case "tool_result":
        state.messages.push(event.message);
        pendingToolResults = pendingToolResults.filter(
          (toolResult) => toolResult.toolCallId !== event.message.toolCallId,
        );
        runtime.render();
        break;

      case "done":
      case "error":
      case "aborted":
        resetUiAgentState();
        runtime.render();
        break;
    }
  };

  const handleInput = (raw: string, state: AppState): void => {
    const parsed = parseInput(raw, {
      supportsImages: state.model?.input.includes("image") ?? false,
      cwd: state.cwd,
    });

    switch (parsed.type) {
      case "command":
        if (!runtime.handleCommand(parsed.command, state)) {
          // Unimplemented command — ignore for now
        }
        break;
      case "skill": {
        const content = buildSkillMessageContent(
          parsed.skillName,
          parsed.userText,
          state,
        );
        if (content) {
          submitMessageAsync(content, state, raw);
        }
        break;
      }
      case "image": {
        const content = buildImageMessageContent(parsed.path, raw, state);
        if (content) {
          submitMessageAsync(content, state, raw);
        }
        break;
      }
      case "text":
        if (parsed.text) {
          submitMessageAsync(parsed.text, state, raw);
        }
        break;
    }
  };

  return { handleInput };
}
