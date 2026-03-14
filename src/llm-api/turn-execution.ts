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

export async function* mapFullStreamToTurnEvents(
	stream: AsyncIterable<{ type?: string; [key: string]: unknown }>,
	opts: {
		onChunk?: (chunk: { type?: string; [key: string]: unknown }) => void;
	},
): AsyncGenerator<TurnEvent> {
	for await (const chunk of stream) {
		if (shouldLogStreamChunk(chunk)) {
			opts.onChunk?.(chunk);
		}
		const event = mapStreamChunkToTurnEvent(chunk);
		if (event) yield event;
	}
}
