/**
 * Shared raw-input resolution and turn submission logic.
 *
 * @module
 */

import { readFileSync } from "node:fs";
import type { UserMessage } from "@mariozechner/pi-ai";
import type { AgentEvent } from "./agent.ts";
import { runAgentLoop } from "./agent.ts";
import { getErrorMessage } from "./errors.ts";
import {
  type AppState,
  buildPrompt,
  buildToolList,
  ensureSession,
  MAX_PROMPT_HISTORY,
} from "./index.ts";
import { parseInput } from "./input.ts";
import {
  appendConversationMessage,
  appendMessage,
  appendPromptHistory,
  filterModelMessages,
  truncatePromptHistory,
} from "./session.ts";
import { executeReadImage } from "./tools.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of resolving raw user input into a command, message, or error. */
export type ResolvedInput =
  | {
      /** Empty/whitespace-only input that should be ignored. */
      type: "empty";
    }
  | {
      /** Parsed slash command. */
      type: "command";
      /** Command name without the leading slash. */
      command: string;
      /** Raw command arguments after trimming. */
      args: string;
    }
  | {
      /** Validation or resolution error for the raw input. */
      type: "error";
      /** User-facing error message. */
      message: string;
    }
  | {
      /** Model-visible message content ready for submission. */
      type: "message";
      /** Fully resolved user content. */
      content: UserMessage["content"];
    };

/** Hooks used by UI and headless mode around a submitted turn. */
export interface SubmitTurnHooks {
  /** Called after the user message is persisted and added to state. */
  onUserMessage?: (state: AppState) => void;
  /** Called after the run switches into the active streaming state. */
  onTurnStart?: (state: AppState) => void;
  /** Called for each agent event emitted during the turn. */
  onEvent?: (event: AgentEvent, state: AppState) => void;
  /** Called after the turn finishes or aborts its active state. */
  onTurnEnd?: (
    state: AppState,
    stopReason: "stop" | "length" | "error" | "aborted" | null,
  ) => void;
}

// ---------------------------------------------------------------------------
// Input resolution helpers
// ---------------------------------------------------------------------------

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

function buildSkillMessageContent(
  skillName: string,
  userText: string,
  state: Pick<AppState, "skills">,
): string | null {
  const skill = state.skills.find((entry) => entry.name === skillName);
  if (!skill) {
    throw new Error(`Unknown skill: ${skillName}`);
  }

  let skillBody: string;
  try {
    skillBody = stripSkillFrontmatter(readFileSync(skill.path, "utf-8")).trim();
  } catch (error) {
    throw new Error(
      `Failed to read skill ${skillName}: ${getErrorMessage(error)}`,
    );
  }
  const parts = [skillBody, userText].filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

function buildImageMessageContent(
  imagePath: string,
  rawInput: string,
  state: Pick<AppState, "cwd">,
): UserMessage["content"] | null {
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
}

/**
 * Resolve raw submitted input into a command, a model-visible message, or an error.
 *
 * This reuses the same parsing rules for interactive and headless input.
 *
 * @param raw - Raw user input.
 * @param state - Current app state needed for skill/image resolution.
 * @returns The resolved input result.
 */
export function resolveRawInput(
  raw: string,
  state: Pick<AppState, "model" | "cwd" | "skills">,
): ResolvedInput {
  const parsed = parseInput(raw, {
    supportsImages: state.model?.input.includes("image") ?? false,
    cwd: state.cwd,
  });

  switch (parsed.type) {
    case "command":
      return {
        type: "command",
        command: parsed.command,
        args: parsed.args,
      };
    case "skill": {
      try {
        const content = buildSkillMessageContent(
          parsed.skillName,
          parsed.userText,
          state,
        );
        return content && !isEmptyUserContent(content)
          ? { type: "message", content }
          : { type: "empty" };
      } catch (error) {
        return {
          type: "error",
          message: getErrorMessage(error),
        };
      }
    }
    case "image": {
      const content = buildImageMessageContent(parsed.path, raw, state);
      return content && !isEmptyUserContent(content)
        ? { type: "message", content }
        : { type: "empty" };
    }
    case "text":
      return parsed.text && !isEmptyUserContent(parsed.text)
        ? { type: "message", content: parsed.text }
        : { type: "empty" };
  }
}

function recordRawPromptHistory(
  rawInput: string,
  state: Pick<AppState, "db" | "cwd">,
  sessionId: string,
): void {
  appendPromptHistory(state.db, {
    text: rawInput,
    cwd: state.cwd,
    sessionId,
  });
  truncatePromptHistory(state.db, MAX_PROMPT_HISTORY);
}

/**
 * Queue resolved user content for the next model-request boundary of an active run.
 *
 * The raw prompt is recorded immediately in prompt history, but the model-visible
 * `UserMessage` is only appended to session history when the agent loop consumes it.
 *
 * @param rawInput - Exact raw submitted prompt text.
 * @param content - Resolved model-visible user content.
 * @param state - Mutable application state.
 */
export function queueResolvedInput(
  rawInput: string,
  content: UserMessage["content"],
  state: AppState,
): void {
  if (!state.running) {
    throw new Error("Cannot queue input while no turn is running.");
  }
  if (isEmptyUserContent(content)) {
    throw new Error("Cannot queue empty input.");
  }

  const session = ensureSession(state);
  recordRawPromptHistory(rawInput, state, session.id);
  state.queuedUserMessages.push({
    role: "user",
    content,
    timestamp: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Turn submission
// ---------------------------------------------------------------------------

function handleAgentEvent(event: AgentEvent, state: AppState): void {
  switch (event.type) {
    case "user_message":
    case "assistant_message":
    case "tool_result":
      appendConversationMessage(state, event.message);
      break;
    case "text_delta":
    case "thinking_delta":
    case "toolcall_start":
    case "toolcall_delta":
    case "toolcall_end":
    case "tool_start":
    case "tool_delta":
    case "tool_end":
    case "done":
    case "error":
    case "aborted":
      break;
  }
}

/**
 * Submit already-resolved user content as one conversational turn.
 *
 * Persists the raw prompt, appends the user message, runs the full agent loop,
 * updates in-memory state as assistant/tool messages arrive, and returns the
 * final stop reason for the turn.
 *
 * @param rawInput - Exact raw submitted prompt text.
 * @param content - Resolved model-visible user content.
 * @param state - Mutable application state.
 * @param hooks - Optional lifecycle hooks for UI/headless integrations.
 * @returns The terminal stop reason for the turn.
 */
export async function submitResolvedInput(
  rawInput: string,
  content: UserMessage["content"],
  state: AppState,
  hooks?: SubmitTurnHooks,
): Promise<"stop" | "length" | "error" | "aborted"> {
  if (!state.model) {
    throw new Error("No model is available for this run.");
  }
  if (state.running) {
    throw new Error("A turn is already running.");
  }
  if (isEmptyUserContent(content)) {
    throw new Error("Cannot submit empty input.");
  }

  const session = ensureSession(state);
  recordRawPromptHistory(rawInput, state, session.id);

  const userMessage = {
    role: "user",
    content,
    timestamp: Date.now(),
  } satisfies UserMessage;

  const turn = appendMessage(state.db, session.id, userMessage);
  appendConversationMessage(state, userMessage);
  hooks?.onUserMessage?.(state);

  const systemPrompt = buildPrompt(state);
  const { tools, toolHandlers } = buildToolList(state);
  const modelMessages = filterModelMessages(state.messages);

  state.running = true;
  state.abortController = new AbortController();
  hooks?.onTurnStart?.(state);

  let stopReason: "stop" | "length" | "error" | "aborted" | null = null;

  try {
    const result = await runAgentLoop({
      db: state.db,
      sessionId: session.id,
      turn,
      model: state.model,
      systemPrompt,
      tools,
      toolHandlers,
      messages: modelMessages,
      cwd: state.cwd,
      apiKey: state.providers.get(state.model.provider),
      effort: state.effort,
      signal: state.abortController.signal,
      takeQueuedUserMessage: () => state.queuedUserMessages.shift() ?? null,
      onEvent: (event) => {
        handleAgentEvent(event, state);
        hooks?.onEvent?.(event, state);
      },
    });
    stopReason = result.stopReason;
    return result.stopReason;
  } finally {
    state.running = false;
    state.abortController = null;
    hooks?.onTurnEnd?.(state, stopReason);
  }
}
