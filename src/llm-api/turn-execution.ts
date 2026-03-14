import type { FlexibleSchema, StepResult } from "ai";
import { dynamicTool, jsonSchema, type streamText } from "ai";
import {
	mapStreamChunkToTurnEvent,
	shouldLogStreamChunk,
} from "./turn-stream-events.ts";
import type { ToolDef, TurnEvent } from "./types.ts";

type StreamTextOptions = Parameters<typeof streamText>[0];
type CoreMessage = NonNullable<StreamTextOptions["messages"]>[number];
type ToolSet = NonNullable<StreamTextOptions["tools"]>;
type ToolEntry = ToolSet extends Record<string, infer T> ? T : never;

export type StreamTextResultFull = ReturnType<typeof streamText> & {
	fullStream: AsyncIterable<{ type?: string; [key: string]: unknown }>;
	response: Promise<{ messages?: CoreMessage[] }>;
};

interface TurnStepState {
	stepCount: number;
	inputTokens: number;
	outputTokens: number;
	contextTokens: number;
	partialMessages: CoreMessage[];
}

interface TurnStepTracker {
	onStepFinish: (step: StepResult<ToolSet>) => void;
	getState: () => TurnStepState;
}

function isZodSchema(s: unknown): boolean {
	return s !== null && typeof s === "object" && "_def" in (s as object);
}

function toCoreTool(def: ToolDef): ReturnType<typeof dynamicTool> {
	const schema = isZodSchema(def.schema)
		? (def.schema as FlexibleSchema<unknown>)
		: jsonSchema(def.schema);
	return dynamicTool({
		description: def.description,
		inputSchema: schema,
		execute: async (input: unknown) => {
			try {
				return await def.execute(input);
			} catch (err) {
				throw err instanceof Error ? err : new Error(String(err));
			}
		},
	});
}

export function buildToolSet(tools: ToolDef[]): ToolSet {
	const toolSet = {} as ToolSet;
	for (const def of tools) {
		(toolSet as Record<string, ToolEntry>)[def.name] = toCoreTool(def);
	}
	return toolSet;
}

export function createTurnStepTracker(opts: {
	onStepLog: (entry: {
		stepNumber: number;
		finishReason: string | null | undefined;
		usage: unknown;
	}) => void;
}): TurnStepTracker {
	let stepCount = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let contextTokens = 0;
	let partialMessages: CoreMessage[] = [];

	return {
		onStepFinish: (step: StepResult<ToolSet>) => {
			opts.onStepLog({
				stepNumber: stepCount + 1,
				finishReason: step.finishReason,
				usage: step.usage,
			});
			inputTokens += step.usage?.inputTokens ?? 0;
			outputTokens += step.usage?.outputTokens ?? 0;
			contextTokens = step.usage?.inputTokens ?? contextTokens;
			stepCount += 1;

			const s = step as unknown as {
				response?: { messages?: CoreMessage[] };
				messages?: CoreMessage[];
			};
			partialMessages = s.response?.messages ?? s.messages ?? partialMessages;
		},
		getState: () => ({
			stepCount,
			inputTokens,
			outputTokens,
			contextTokens,
			partialMessages,
		}),
	};
}

interface StreamToolChunk {
	type?: string;
	toolName?: unknown;
	toolCallId?: unknown;
	[key: string]: unknown;
}

interface StreamTextChunk {
	type?: string;
	id?: unknown;
	providerMetadata?: unknown;
	providerOptions?: unknown;
	[key: string]: unknown;
}

const TOOL_START_CHUNK_TYPES = new Set(["tool-input-start", "tool-call"]);
const TOOL_RESULT_CHUNK_TYPES = new Set(["tool-result", "tool-error"]);

function normalizeToolCallId(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim();
	return trimmed ? trimmed : null;
}

function normalizeToolName(raw: unknown): string {
	if (typeof raw !== "string") return "tool";
	const trimmed = raw.trim();
	return trimmed || "tool";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

function normalizeTextPartId(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim();
	return trimmed ? trimmed : null;
}

function getOpenAITextPhase(
	chunk: StreamTextChunk,
): "commentary" | "final_answer" | null {
	const providerData = isRecord(chunk.providerMetadata)
		? chunk.providerMetadata
		: isRecord(chunk.providerOptions)
			? chunk.providerOptions
			: null;
	if (!providerData) return null;
	const openai = providerData.openai;
	if (!isRecord(openai)) return null;
	return openai.phase === "commentary" || openai.phase === "final_answer"
		? openai.phase
		: null;
}

type StreamTextRoute = "skip" | "text" | "reasoning";

function extractTextDelta(chunk: StreamTextChunk): string {
	if (typeof chunk.text === "string") return chunk.text;
	if (typeof chunk.textDelta === "string") return chunk.textDelta;
	if (typeof chunk.delta === "string") return chunk.delta;
	return "";
}

class StreamTextPhaseTracker {
	private phaseByTextPartId = new Map<string, "commentary" | "final_answer">();

	route(chunk: StreamTextChunk): StreamTextRoute {
		const textPartId = normalizeTextPartId(chunk.id);
		switch (chunk.type) {
			case "text-start": {
				const phase = getOpenAITextPhase(chunk);
				if (textPartId && phase) this.phaseByTextPartId.set(textPartId, phase);
				return "skip";
			}
			case "text-end": {
				if (textPartId) this.phaseByTextPartId.delete(textPartId);
				return "skip";
			}
			case "text-delta": {
				if (!textPartId) return "text";
				return this.phaseByTextPartId.get(textPartId) === "commentary"
					? "reasoning"
					: "text";
			}
			default:
				return "text";
		}
	}
}

function mapCommentaryChunkToTurnEvent(
	chunk: StreamTextChunk,
): TurnEvent | null {
	if (chunk.type !== "text-delta") return null;
	return {
		type: "reasoning-delta",
		delta: extractTextDelta(chunk),
	};
}

class StreamToolCallTracker {
	private syntheticCount = 0;
	private pendingByTool = new Map<string, string[]>();

	assign(chunk: StreamToolChunk): StreamToolChunk {
		const type = chunk.type;
		if (!type) return chunk;

		if (TOOL_START_CHUNK_TYPES.has(type)) {
			const toolName = normalizeToolName(chunk.toolName);
			const toolCallId =
				normalizeToolCallId(chunk.toolCallId) ?? this.nextSyntheticToolCallId();
			this.trackStart(toolName, toolCallId);
			if (toolCallId === chunk.toolCallId) return chunk;
			return { ...chunk, toolCallId };
		}

		if (TOOL_RESULT_CHUNK_TYPES.has(type)) {
			const toolName = normalizeToolName(chunk.toolName);
			const existingToolCallId = normalizeToolCallId(chunk.toolCallId);
			if (existingToolCallId) {
				this.consumeTracked(toolName, existingToolCallId);
				return chunk;
			}
			const toolCallId =
				this.consumeNextTracked(toolName) ?? this.nextSyntheticToolCallId();
			return { ...chunk, toolCallId };
		}

		return chunk;
	}

	private nextSyntheticToolCallId(): string {
		this.syntheticCount += 1;
		return `synthetic-tool-call-${this.syntheticCount}`;
	}

	private trackStart(toolName: string, toolCallId: string): void {
		const pending = this.pendingByTool.get(toolName) ?? [];
		pending.push(toolCallId);
		this.pendingByTool.set(toolName, pending);
	}

	private consumeTracked(toolName: string, toolCallId: string): void {
		const pending = this.pendingByTool.get(toolName);
		if (!pending || pending.length === 0) return;
		const idx = pending.indexOf(toolCallId);
		if (idx === -1) return;
		pending.splice(idx, 1);
		if (pending.length === 0) this.pendingByTool.delete(toolName);
	}

	private consumeNextTracked(toolName: string): string | null {
		const pending = this.pendingByTool.get(toolName);
		if (!pending || pending.length === 0) return null;
		const toolCallId = pending.shift() ?? null;
		if (pending.length === 0) this.pendingByTool.delete(toolName);
		return toolCallId;
	}
}

export async function* mapFullStreamToTurnEvents(
	stream: AsyncIterable<{ type?: string; [key: string]: unknown }>,
	opts: {
		onChunk?: (chunk: { type?: string; [key: string]: unknown }) => void;
	},
): AsyncGenerator<TurnEvent> {
	const toolCallTracker = new StreamToolCallTracker();
	const textPhaseTracker = new StreamTextPhaseTracker();
	for await (const originalChunk of stream) {
		const chunk = toolCallTracker.assign(originalChunk);
		const route = textPhaseTracker.route(chunk);
		if (route !== "skip" && shouldLogStreamChunk(chunk)) {
			opts.onChunk?.(chunk);
		}
		if (route === "skip") continue;
		const event =
			route === "reasoning"
				? mapCommentaryChunkToTurnEvent(chunk)
				: mapStreamChunkToTurnEvent(chunk);
		if (event) yield event;
	}
}
