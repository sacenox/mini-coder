import { pruneMessages } from "ai";
import { isRecord } from "./history/shared.ts";
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

const DEFAULT_TOOL_RESULT_PAYLOAD_CAP_BYTES = 16 * 1024;

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
			let payload: unknown = null;
			if ("output" in partRecord) payload = partRecord.output;
			else if ("result" in partRecord) payload = partRecord.result;
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

export function applyContextPruning(messages: CoreMessage[]): CoreMessage[] {
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
): CoreMessage[] {
	const capBytes = DEFAULT_TOOL_RESULT_PAYLOAD_CAP_BYTES;

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

			let payload: unknown = null;
			if ("output" in part) payload = part.output;
			else if ("result" in part) payload = part.result;
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

function withCacheBreakpoint(msg: CoreMessage): CoreMessage {
	return {
		...msg,
		providerOptions: {
			...(msg?.providerOptions ?? {}),
			anthropic: {
				...((msg?.providerOptions?.anthropic as Record<string, unknown>) ?? {}),
				cacheControl: { type: "ephemeral" },
			},
		},
	} as CoreMessage;
}

/**
 * Add Anthropic ephemeral cache breakpoints to messages. Designed to run
 * per-step via middleware so breakpoints always track the conversation tail.
 *
 * Anthropic allows max 4 breakpoints per request. We reserve 1 for tool
 * caching (see annotateToolCaching), leaving 3 for messages:
 *   - First system message (stable prefix)
 *   - Last 2 non-system messages (moving tail)
 */
export function annotateAnthropicCacheBreakpoints(
	prompt: CoreMessage[],
): CoreMessage[] {
	const result = [...prompt];
	const systemIdxs: number[] = [];
	const nonSystemIdxs: number[] = [];

	for (let i = 0; i < result.length; i++) {
		if (result[i]?.role === "system") systemIdxs.push(i);
		else nonSystemIdxs.push(i);
	}

	// Annotate first system message
	for (const idx of systemIdxs.slice(0, 1)) {
		result[idx] = withCacheBreakpoint(result[idx] as CoreMessage);
	}

	// Annotate last 2 non-system messages
	for (const idx of nonSystemIdxs.slice(-2)) {
		result[idx] = withCacheBreakpoint(result[idx] as CoreMessage);
	}

	return result;
}
