import {
	isGeminiModelFamily,
	isOpenAIGPTModelFamily,
	isZenOpenAICompatibleChatModel,
} from "./model-routing.ts";
import type { CoreMessage } from "./turn.ts";

type StreamChunk = { type?: string; [key: string]: unknown };

type GeminiToolHistoryRepairReason = "missing-signature-anchor";

function isRecord(value: unknown): value is Record<string, unknown> {
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

function normalizeMessageProviderOptions(message: CoreMessage): CoreMessage {
	if (!Array.isArray(message.content)) return message;
	return {
		...message,
		content: message.content.map((part) =>
			normalizeProviderOptions(part),
		) as CoreMessage["content"],
	} as CoreMessage;
}

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

function getPartProviderOptions(part: unknown): Record<string, unknown> | null {
	if (!isRecord(part)) return null;
	if (isRecord(part.providerOptions)) return part.providerOptions;
	if (isRecord(part.providerMetadata)) return part.providerMetadata;
	return null;
}

function getGeminiThoughtSignature(part: unknown): string | null {
	const providerOptions = getPartProviderOptions(part);
	if (!providerOptions) return null;

	for (const provider of ["google", "vertex"] as const) {
		const metadata = providerOptions[provider];
		if (!isRecord(metadata)) continue;
		const signature = metadata.thoughtSignature;
		if (typeof signature === "string" && signature.length > 0) {
			return signature;
		}
	}

	return null;
}

function isToolCallPart(part: unknown): part is Record<string, unknown> {
	return isRecord(part) && part.type === "tool-call";
}

function validateGeminiAssistantToolCallMessage(message: CoreMessage): {
	valid: boolean;
	reason: GeminiToolHistoryRepairReason | null;
} {
	if (message.role !== "assistant" || !Array.isArray(message.content)) {
		return { valid: true, reason: null };
	}

	let firstToolCallPartSeen = false;
	for (const part of message.content) {
		if (!isToolCallPart(part)) continue;
		if (firstToolCallPartSeen) continue;
		firstToolCallPartSeen = true;
		if (getGeminiThoughtSignature(part) === null) {
			return { valid: false, reason: "missing-signature-anchor" };
		}
	}

	return { valid: true, reason: null };
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

export function getReasoningDeltaFromStreamChunk(
	chunk: StreamChunk,
): string | null {
	if (chunk.type !== "reasoning-delta" && chunk.type !== "reasoning") {
		return null;
	}
	if (typeof chunk.text === "string") return chunk.text;
	if (typeof chunk.textDelta === "string") return chunk.textDelta;
	if (typeof chunk.delta === "string") return chunk.delta;
	return "";
}

export function isOpenAIGPT(modelString: string): boolean {
	return isOpenAIGPTModelFamily(modelString);
}

export function stripOpenAIItemIdsFromHistory(
	messages: CoreMessage[],
	modelString: string,
): CoreMessage[] {
	if (!isOpenAIGPT(modelString)) return messages;

	let mutated = false;
	const result = messages.map((message) => {
		if (!Array.isArray(message.content)) return message;

		let contentMutated = false;
		const content = message.content.map((part) => {
			const cleaned = stripOpenAIItemIdFromPart(part);
			if (cleaned.changed) contentMutated = true;
			return cleaned.part;
		});

		if (!contentMutated) return message;
		mutated = true;
		return {
			...message,
			content: content as CoreMessage["content"],
		} as CoreMessage;
	});

	return mutated ? result : messages;
}

export function normalizeOpenAICompatibleToolCallInputs(
	messages: CoreMessage[],
	modelString: string,
): CoreMessage[] {
	if (!isZenOpenAICompatibleChatModel(modelString)) return messages;

	let mutated = false;
	const result = messages.map((message) => {
		if (message.role !== "assistant" || !Array.isArray(message.content)) {
			return message;
		}

		let contentMutated = false;
		const nextContent = message.content.map((part) => {
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
				contentMutated = true;
				return {
					...part,
					input: parsed,
				};
			} catch {
				return part;
			}
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

export function sanitizeGeminiToolMessagesWithMetadata(
	messages: CoreMessage[],
	modelString: string,
	hasTools: boolean,
): {
	messages: CoreMessage[];
	repaired: boolean;
	reason: GeminiToolHistoryRepairReason | null;
	repairedFromIndex: number;
	droppedMessageCount: number;
	tailOnlyAffected: boolean;
} {
	if (!hasTools || !isGeminiModelFamily(modelString)) {
		return {
			messages,
			repaired: false,
			reason: null,
			repairedFromIndex: -1,
			droppedMessageCount: 0,
			tailOnlyAffected: true,
		};
	}

	const normalized = messages.map((message) =>
		normalizeMessageProviderOptions(message),
	);

	for (let index = normalized.length - 1; index >= 0; index -= 1) {
		const message = normalized[index];
		if (!message) continue;
		if (message.role !== "assistant" || !Array.isArray(message.content))
			continue;
		if (!message.content.some((part) => isToolCallPart(part))) continue;

		const validation = validateGeminiAssistantToolCallMessage(message);
		if (validation.valid) {
			return {
				messages: normalized,
				repaired: false,
				reason: null,
				repairedFromIndex: -1,
				droppedMessageCount: 0,
				tailOnlyAffected: true,
			};
		}

		const nextUserIndex = normalized.findIndex(
			(candidate, candidateIndex) =>
				candidateIndex > index && candidate?.role === "user",
		);
		if (nextUserIndex === -1) {
			return {
				messages: normalized.slice(0, index),
				repaired: true,
				reason: validation.reason,
				repairedFromIndex: index,
				droppedMessageCount: normalized.length - index,
				tailOnlyAffected: true,
			};
		}

		return {
			messages: [
				...normalized.slice(0, index),
				...normalized.slice(nextUserIndex),
			],
			repaired: true,
			reason: validation.reason,
			repairedFromIndex: index,
			droppedMessageCount: nextUserIndex - index,
			tailOnlyAffected: false,
		};
	}

	return {
		messages: normalized,
		repaired: false,
		reason: null,
		repairedFromIndex: -1,
		droppedMessageCount: 0,
		tailOnlyAffected: true,
	};
}

export function sanitizeGeminiToolMessages(
	messages: CoreMessage[],
	modelString: string,
	hasTools: boolean,
): CoreMessage[] {
	return sanitizeGeminiToolMessagesWithMetadata(messages, modelString, hasTools)
		.messages;
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
