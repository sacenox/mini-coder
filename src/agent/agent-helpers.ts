import type { CoreMessage } from "../llm-api/turn.ts";

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
				if (part?.type === "text" && part.text) parts.push(part.text);
			}
		}
	}
	return parts.join("\n");
}

export function hasRalphSignal(text: string): boolean {
	return /\/ralph\b/.test(text);
}

export function buildRalphIterationPrompt(goal: string): string {
	return `${goal}\n\n<system-message>RALPH MODE: Work autonomously toward the goal. **Only when the task is fully complete**, output \`/ralph\` as your final message.</system-message>`;
}
