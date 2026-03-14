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
