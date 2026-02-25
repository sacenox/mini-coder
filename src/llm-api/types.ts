import type { CoreMessage } from "./turn.ts";

// ─── Turn events (streamed to the caller) ─────────────────────────────────────

export interface TextDeltaEvent {
	type: "text-delta";
	delta: string;
}

export interface ToolCallStartEvent {
	type: "tool-call-start";
	toolCallId: string;
	toolName: string;
	args: unknown;
}

export interface ToolResultEvent {
	type: "tool-result";
	toolCallId: string;
	toolName: string;
	result: unknown;
	isError: boolean;
}

export interface TurnCompleteEvent {
	type: "turn-complete";
	inputTokens: number;
	outputTokens: number;
	/** Input tokens of the final step — equals the actual context window usage. */
	contextTokens: number;
	/**
	 * Raw AI SDK ModelMessage objects generated this turn.
	 * These are passed directly back to streamText on subsequent turns —
	 * do NOT convert them through the internal Message type or they will
	 * lose `input`/`output` field fidelity and fail schema validation.
	 */
	messages: CoreMessage[];
}

export interface TurnErrorEvent {
	type: "turn-error";
	error: Error;
}

export type TurnEvent =
	| TextDeltaEvent
	| ToolCallStartEvent
	| ToolResultEvent
	| TurnCompleteEvent
	| TurnErrorEvent;

// ─── Tool definition ──────────────────────────────────────────────────────────

export interface ToolDef<TInput = unknown, TOutput = unknown> {
	name: string;
	description: string;
	/** Zod schema — typed as unknown here, cast at call sites */
	schema: unknown;
	execute: (input: TInput) => Promise<TOutput>;
}
