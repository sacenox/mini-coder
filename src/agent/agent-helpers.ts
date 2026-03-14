import type { CoreMessage } from "../llm-api/turn.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

function isCommentaryTextPart(part: unknown): boolean {
	if (!isRecord(part) || part.type !== "text") return false;
	const providerData = isRecord(part.providerOptions)
		? part.providerOptions
		: isRecord(part.providerMetadata)
			? part.providerMetadata
			: null;
	if (!providerData || !isRecord(providerData.openai)) return false;
	return providerData.openai.phase === "commentary";
}

export function makeInterruptMessage(reason: "user" | "error"): CoreMessage {
	const text =
		reason === "user"
			? "<system-message>Response was interrupted by the user.</system-message>"
			: "<system-message>Response was interrupted due to an error.</system-message>";
	return { role: "assistant", content: text };
}

export function isAbortError(error: Error): boolean {
	return (
		error.name === "AbortError" ||
		(error.name === "Error" && error.message.toLowerCase().includes("abort"))
	);
}

export function buildAbortMessages(
	partialMessages: CoreMessage[],
	accumulatedText?: string,
): CoreMessage[] {
	const stub = makeInterruptMessage("user");
	const content = accumulatedText
		? `${accumulatedText}${stub.content}`
		: (stub.content as string);
	const partialMsg: CoreMessage = { role: "assistant", content };
	return [...partialMessages, partialMsg];
}

export function extractAssistantText(newMessages: CoreMessage[]): string {
	const parts: string[] = [];
	for (const msg of newMessages) {
		if (msg.role !== "assistant") continue;
		const content = msg.content;
		if (typeof content === "string") {
			parts.push(content);
		} else if (Array.isArray(content)) {
			for (const part of content as Array<{ type?: string; text?: string }>) {
				if (part?.type === "text" && part.text && !isCommentaryTextPart(part)) {
					parts.push(part.text);
				}
			}
		}
	}
	return parts.join("\n");
}
