/**
 * Shared helpers for extracting user-visible assistant output.
 *
 * @module
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import {
  collapseWhitespaceToNull,
  joinTextBlocks,
  truncateText,
} from "./text.ts";

const ASSISTANT_ACTIVITY_MAX_CHARS = 160;

/**
 * Extract concatenated text blocks from an assistant message.
 *
 * @param message - Assistant message to inspect.
 * @returns The combined text content, or an empty string when none exists.
 */
export function extractAssistantText(message: AssistantMessage | null): string {
  if (!message) {
    return "";
  }

  return message.content
    .filter(
      (
        block,
      ): block is Extract<
        AssistantMessage["content"][number],
        { type: "text" }
      > => {
        return block.type === "text";
      },
    )
    .map((block) => block.text)
    .join("");
}

/**
 * Extract a short assistant activity snippet from a tool-using message.
 *
 * @param message - Assistant message to inspect.
 * @returns A collapsed activity snippet, or `null` when no snippet applies.
 */
export function extractAssistantActivitySnippet(
  message: AssistantMessage,
): string | null {
  if (!message.content.some((block) => block.type === "toolCall")) {
    return null;
  }

  const text = collapseWhitespaceToNull(joinTextBlocks(message.content));
  return text ? truncateText(text, ASSISTANT_ACTIVITY_MAX_CHARS) : null;
}

/**
 * Extract terminal assistant error text from a failed assistant message.
 *
 * @param message - Assistant message to inspect.
 * @returns Collapsed error text, or `null` when the message is not terminally errored.
 */
export function extractAssistantErrorText(
  message: AssistantMessage | null,
): string | null {
  if (!message || message.stopReason !== "error" || !message.errorMessage) {
    return null;
  }

  return collapseWhitespaceToNull(message.errorMessage) ?? null;
}
