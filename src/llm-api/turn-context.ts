import { pruneMessages } from "ai";
import type { CoreMessage } from "./turn.ts";

interface ToolContributorStats {
	toolName: string;
	count: number;
	bytes: number;
}

interface RoleStats {
	count: number;
	bytes: number;
}

interface MessageDiagnostics {
	messageCount: number;
	totalBytes: number;
	roleBreakdown: Record<string, RoleStats>;
	toolResults: {
		count: number;
		bytes: number;
		topContributors: ToolContributorStats[];
	};
}

export const DEFAULT_TOOL_RESULT_PAYLOAD_CAP_BYTES = 16 * 1024;

function getByteLength(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? "null";
	} catch {
		return JSON.stringify(String(value));
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

/**
 * Lightweight alternative to getMessageDiagnostics that computes only the
 * fields needed for the context-pruned yield event (no roleBreakdown / tool
 * contributor maps). Used when the API log is disabled.
 */
export function getMessageStats(messages: CoreMessage[]): {
	messageCount: number;
	totalBytes: number;
} {
	let totalBytes = 0;
	for (const m of messages) totalBytes += getByteLength(safeStringify(m));
	return { messageCount: messages.length, totalBytes };
}

export function getMessageDiagnostics(
	messages: CoreMessage[],
): MessageDiagnostics {
	const roleBreakdown: Record<string, RoleStats> = {};
	const toolContributorMap = new Map<
		string,
		{ count: number; bytes: number }
	>();
	let totalBytes = 0;
	let toolResultBytes = 0;
	let toolResultCount = 0;

	for (const message of messages) {
		const serializedMessage = safeStringify(message);
		const messageBytes = getByteLength(serializedMessage);
		totalBytes += messageBytes;

		const role = message.role;
		const roleStats = roleBreakdown[role] ?? { count: 0, bytes: 0 };
		roleStats.count += 1;
		roleStats.bytes += messageBytes;
		roleBreakdown[role] = roleStats;

		if (!Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (!isRecord(part)) continue;
			const partType = (part as { type?: unknown }).type;
			if (partType !== "tool-result") continue;
			toolResultCount += 1;

			const partRecord = part as Record<string, unknown>;
			const rawToolName = partRecord.toolName;
			const toolName =
				typeof rawToolName === "string" && rawToolName.length > 0
					? rawToolName
					: "unknown";
			const payload =
				"output" in partRecord
					? partRecord.output
					: "result" in partRecord
						? partRecord.result
						: null;
			const payloadBytes = getByteLength(safeStringify(payload));
			toolResultBytes += payloadBytes;

			const existing = toolContributorMap.get(toolName) ?? {
				count: 0,
				bytes: 0,
			};
			existing.count += 1;
			existing.bytes += payloadBytes;
			toolContributorMap.set(toolName, existing);
		}
	}

	const topContributors = [...toolContributorMap.entries()]
		.map(([toolName, stats]) => ({
			toolName,
			count: stats.count,
			bytes: stats.bytes,
		}))
		.sort((a, b) =>
			b.bytes === a.bytes
				? a.toolName.localeCompare(b.toolName)
				: b.bytes - a.bytes,
		)
		.slice(0, 5);

	return {
		messageCount: messages.length,
		totalBytes,
		roleBreakdown,
		toolResults: {
			count: toolResultCount,
			bytes: toolResultBytes,
			topContributors,
		},
	};
}

export type ContextPruningMode = "off" | "balanced" | "aggressive";

export function applyContextPruning(
	messages: CoreMessage[],
	mode: ContextPruningMode,
): CoreMessage[] {
	if (mode === "off") return messages;
	if (mode === "aggressive") {
		return pruneMessages({
			messages,
			reasoning: "before-last-message",
			toolCalls: "before-last-20-messages",
			emptyMessages: "remove",
		}) as CoreMessage[];
	}

	return pruneMessages({
		messages,
		reasoning: "before-last-message",
		toolCalls: "before-last-40-messages",
		emptyMessages: "remove",
	}) as CoreMessage[];
}

function compactHeadTail(
	serialized: string,
	maxChars = 4096,
): { head: string; tail: string } {
	const chars = Math.max(512, maxChars);
	const headLength = Math.floor(chars / 2);
	const tailLength = chars - headLength;
	return {
		head: serialized.slice(0, headLength),
		tail: serialized.slice(-tailLength),
	};
}

function wrapCompactedToolResultOutput(
	compactedPayload: Record<string, unknown>,
): unknown {
	return {
		type: "json",
		value: compactedPayload,
	};
}

export function compactToolResultPayloads(
	messages: CoreMessage[],
	capBytes = DEFAULT_TOOL_RESULT_PAYLOAD_CAP_BYTES,
): CoreMessage[] {
	if (!Number.isFinite(capBytes) || capBytes <= 0) return messages;

	let mutated = false;
	const compacted = messages.map((message) => {
		if (message.role !== "tool" || !Array.isArray(message.content)) {
			return message;
		}

		let contentMutated = false;
		const nextContent = message.content.map((part) => {
			if (!isRecord(part)) return part;
			const partType = (part as { type?: unknown }).type;
			if (partType !== "tool-result") return part;

			const payload =
				"output" in part ? part.output : "result" in part ? part.result : null;
			const serializedPayload = safeStringify(payload);
			const originalBytes = getByteLength(serializedPayload);
			if (originalBytes <= capBytes) return part;

			const { head, tail } = compactHeadTail(
				serializedPayload,
				Math.floor(capBytes / 2),
			);
			const compactedPayload = {
				truncated: true,
				originalBytes,
				strategy: "head-tail",
				head,
				tail,
			};

			contentMutated = true;
			if ("output" in part) {
				return {
					...part,
					output: wrapCompactedToolResultOutput(compactedPayload),
				};
			}
			if ("result" in part) {
				return { ...part, result: compactedPayload };
			}
			return {
				...part,
				output: wrapCompactedToolResultOutput(compactedPayload),
			};
		});

		if (!contentMutated) return message;
		mutated = true;
		return {
			...message,
			content: nextContent as CoreMessage["content"],
		} as CoreMessage;
	});

	return mutated ? compacted : messages;
}

export function annotateAnthropicCacheBreakpoints(
	turnMessages: CoreMessage[],
	systemPrompt?: string,
): {
	messages: CoreMessage[];
	systemPrompt?: string;
	diagnostics: { breakpointsAdded: number; stableIdx: number };
} {
	const finalMessages = [...turnMessages];
	let breakpointsAdded = 0;

	const stableIdx = finalMessages.length > 2 ? finalMessages.length - 2 : -1;
	if (stableIdx >= 0 && finalMessages[stableIdx]) {
		const msg = finalMessages[stableIdx];
		finalMessages[stableIdx] = {
			...msg,
			providerOptions: {
				...(msg?.providerOptions ?? {}),
				anthropic: {
					...((msg?.providerOptions?.anthropic as Record<string, unknown>) ??
						{}),
					cacheControl: { type: "ephemeral" },
				},
			},
		} as CoreMessage;
		breakpointsAdded++;
	}

	let finalSystemPrompt = systemPrompt;
	if (systemPrompt) {
		finalMessages.unshift({
			role: "system",
			content: systemPrompt,
			providerOptions: {
				anthropic: { cacheControl: { type: "ephemeral" } },
			},
		});
		finalSystemPrompt = undefined;
		breakpointsAdded++;
	}

	return {
		messages: finalMessages,
		...(finalSystemPrompt !== undefined
			? { systemPrompt: finalSystemPrompt }
			: {}),
		diagnostics: { breakpointsAdded, stableIdx },
	};
}
