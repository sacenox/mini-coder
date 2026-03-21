import {
  isOpenAIGPTModelFamily,
  isZenOpenAICompatibleChatModel,
} from "../model-routing.ts";
import type { CoreMessage } from "../turn.ts";
import {
  getPartProviderOptions,
  isRecord,
  isToolCallPart,
  mapAssistantParts,
} from "./shared.ts";

function stripOpenAIItemIdFromPart(part: unknown): {
  part: unknown;
  changed: boolean;
} {
  if (!isRecord(part)) return { part, changed: false };

  let changed = false;
  const nextPart = { ...part };

  const dropItemId = (field: "providerOptions" | "providerMetadata"): void => {
    const source = nextPart[field];
    if (!isRecord(source)) return;
    const openai = source.openai;
    if (!isRecord(openai) || !("itemId" in openai)) return;

    const nextOpenAI = { ...openai };
    delete nextOpenAI.itemId;
    nextPart[field] = { ...source, openai: nextOpenAI };
    changed = true;
  };

  dropItemId("providerOptions");
  dropItemId("providerMetadata");

  return { part: changed ? nextPart : part, changed };
}

function getOpenAITextPhase(part: unknown): string | null {
  const providerOptions = getPartProviderOptions(part);
  if (!providerOptions) return null;
  const openai = providerOptions.openai;
  if (!isRecord(openai)) return null;
  return typeof openai.phase === "string" ? openai.phase : null;
}

function isCommentaryTextPart(part: unknown): boolean {
  if (!isRecord(part) || part.type !== "text") return false;
  return getOpenAITextPhase(part) === "commentary";
}

export function isOpenAIGPT(modelString: string): boolean {
  return isOpenAIGPTModelFamily(modelString);
}

export function normalizeOpenAICompatibleToolCallInputs(
  messages: CoreMessage[],
  modelString: string,
): CoreMessage[] {
  if (!isZenOpenAICompatibleChatModel(modelString)) return messages;

  return mapAssistantParts(messages, (part) => {
    if (
      !isToolCallPart(part) ||
      !("input" in part) ||
      typeof part.input !== "string"
    ) {
      return part;
    }

    try {
      const parsed = JSON.parse(part.input);
      if (!isRecord(parsed) || Array.isArray(parsed)) return part;
      return { ...part, input: parsed };
    } catch {
      return part;
    }
  });
}

function stripOpenAIHistory(
  messages: CoreMessage[],
  modelString: string,
  options: { stripItemIds: boolean },
): CoreMessage[] {
  if (!isOpenAIGPT(modelString)) return messages;

  let mutated = false;
  const result: CoreMessage[] = [];
  let skipToolResults = false;

  for (const message of messages) {
    if (skipToolResults) {
      if (message.role === "tool") {
        mutated = true;
        continue;
      }
      skipToolResults = false;
    }

    let messageForCommentary = message;
    if (options.stripItemIds && Array.isArray(message.content)) {
      let contentMutated = false;
      const strippedContent = message.content.map((part) => {
        const cleaned = stripOpenAIItemIdFromPart(part);
        if (cleaned.changed) contentMutated = true;
        return cleaned.part;
      });
      if (contentMutated) {
        mutated = true;
        messageForCommentary = {
          ...message,
          content: strippedContent as CoreMessage["content"],
        } as CoreMessage;
      }
    }

    if (
      messageForCommentary.role !== "assistant" ||
      !Array.isArray(messageForCommentary.content)
    ) {
      result.push(messageForCommentary);
      continue;
    }

    const filtered = messageForCommentary.content.filter(
      (part) => !isCommentaryTextPart(part),
    );
    if (filtered.length === messageForCommentary.content.length) {
      result.push(messageForCommentary);
    } else if (filtered.length === 0) {
      mutated = true;
      skipToolResults = true;
    } else {
      mutated = true;
      result.push({
        ...messageForCommentary,
        content: filtered,
      } as CoreMessage);
    }
  }

  return mutated ? result : messages;
}

export function stripGPTCommentaryFromHistory(
  messages: CoreMessage[],
  modelString: string,
): CoreMessage[] {
  return stripOpenAIHistory(messages, modelString, { stripItemIds: false });
}

export function stripOpenAIHistoryTransforms(
  messages: CoreMessage[],
  modelString: string,
): CoreMessage[] {
  return stripOpenAIHistory(messages, modelString, { stripItemIds: true });
}
