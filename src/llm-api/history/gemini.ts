import { isGeminiModelFamily } from "../model-routing.ts";
import type { CoreMessage } from "../turn.ts";
import {
	getPartProviderOptions,
	isRecord,
	isToolCallPart,
	normalizeMessageProviderOptions,
} from "./shared.ts";

export type GeminiToolHistoryRepairReason = "missing-signature-anchor";

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
