import type { CoreMessage } from "../turn.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function normalizeProviderOptions<T>(part: T): T {
  if (!isRecord(part)) return part;
  if (
    part.providerOptions !== undefined ||
    part.providerMetadata === undefined
  ) {
    return part;
  }
  return {
    ...part,
    providerOptions: part.providerMetadata,
  } as T;
}

export function normalizeMessageProviderOptions(
  message: CoreMessage,
): CoreMessage {
  if (!Array.isArray(message.content)) return message;
  return {
    ...message,
    content: message.content.map((part) =>
      normalizeProviderOptions(part),
    ) as CoreMessage["content"],
  } as CoreMessage;
}

export function getPartProviderOptions(
  part: unknown,
): Record<string, unknown> | null {
  if (!isRecord(part)) return null;
  if (isRecord(part.providerOptions)) return part.providerOptions;
  if (isRecord(part.providerMetadata)) return part.providerMetadata;
  return null;
}

export function isToolCallPart(part: unknown): part is Record<string, unknown> {
  return isRecord(part) && part.type === "tool-call";
}

function hasObjectToolCallInput(
  part: unknown,
): part is Record<string, unknown> & { input: Record<string, unknown> } {
  return (
    isToolCallPart(part) &&
    "input" in part &&
    isRecord(part.input) &&
    !Array.isArray(part.input)
  );
}

/**
 * Map over assistant messages' content parts, applying a transform to each.
 * Returns the original array when nothing changed (reference-stable).
 */
export function mapAssistantParts(
  messages: CoreMessage[],
  transform: (part: unknown) => unknown,
): CoreMessage[] {
  let mutated = false;
  const result = messages.map((message) => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      return message;
    }

    let contentMutated = false;
    const nextContent = message.content.map((part) => {
      const next = transform(part);
      if (next !== part) contentMutated = true;
      return next;
    });

    if (!contentMutated) return message;
    mutated = true;
    return {
      ...message,
      content: nextContent as CoreMessage["content"],
    } as CoreMessage;
  });

  return mutated ? result : messages;
}

const TOOL_RUNTIME_INPUT_KEYS = new Set(["cwd"]);

export function stripToolRuntimeInputFields(
  messages: CoreMessage[],
): CoreMessage[] {
  return mapAssistantParts(messages, (part) => {
    if (!hasObjectToolCallInput(part)) return part;

    let inputMutated = false;
    const nextInput = { ...part.input };
    for (const key of TOOL_RUNTIME_INPUT_KEYS) {
      if (!(key in nextInput)) continue;
      delete nextInput[key];
      inputMutated = true;
    }
    return inputMutated ? { ...part, input: nextInput } : part;
  });
}
