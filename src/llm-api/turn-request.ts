import { stepCountIs, type streamText } from "ai";

import type { ThinkingEffort } from "./provider-options.ts";
import type { ContextPruningMode } from "./turn-context.ts";
import { prepareTurnMessages } from "./turn-prepare-messages.ts";
import { buildTurnProviderOptions } from "./turn-provider-options.ts";

type StreamTextOptions = Parameters<typeof streamText>[0];
type CoreMessage = NonNullable<StreamTextOptions["messages"]>[number];
type CoreModel = StreamTextOptions["model"];
type ToolSet = NonNullable<StreamTextOptions["tools"]>;

interface BuildTurnPreparationInput {
	modelString: string;
	messages: CoreMessage[];
	thinkingEffort: ThinkingEffort | undefined;
	promptCachingEnabled: boolean;
	openaiPromptCacheRetention: "in_memory" | "24h";
	googleCachedContent: string | null;
	toolCount: number;
	systemPrompt: string | undefined;
	pruningMode: ContextPruningMode;
	toolResultPayloadCapBytes: number;
}

export function buildTurnPreparation(input: BuildTurnPreparationInput): {
	providerOptionsResult: ReturnType<typeof buildTurnProviderOptions>;
	prepared: ReturnType<typeof prepareTurnMessages>;
} {
	const providerOptionsResult = buildTurnProviderOptions({
		modelString: input.modelString,
		thinkingEffort: input.thinkingEffort,
		promptCachingEnabled: input.promptCachingEnabled,
		openaiPromptCacheRetention: input.openaiPromptCacheRetention,
		googleCachedContent: input.googleCachedContent,
		toolCount: input.toolCount,
		hasSystemPrompt: Boolean(input.systemPrompt),
	});

	const prepared = prepareTurnMessages({
		messages: input.messages,
		modelString: input.modelString,
		toolCount: input.toolCount,
		systemPrompt: input.systemPrompt,
		pruningMode: input.pruningMode,
		toolResultPayloadCapBytes: input.toolResultPayloadCapBytes,
		promptCachingEnabled: input.promptCachingEnabled,
	});

	return { providerOptionsResult, prepared };
}

interface BuildStreamTextRequestInput {
	model: CoreModel;
	prepared: ReturnType<typeof prepareTurnMessages>;
	toolSet: ToolSet;
	onStepFinish: NonNullable<StreamTextOptions["onStepFinish"]>;
	signal: AbortSignal | undefined;
	providerOptions: Record<string, unknown>;
	maxSteps: number;
}

export function buildStreamTextRequest(
	input: BuildStreamTextRequestInput,
): StreamTextOptions {
	return {
		model: input.model,
		messages: input.prepared.messages,
		tools: input.toolSet,
		stopWhen: stepCountIs(input.maxSteps),
		onStepFinish: input.onStepFinish,
		prepareStep: ({ stepNumber }: { stepNumber: number }) => {
			if (stepNumber >= input.maxSteps - 1) {
				return { activeTools: [] as Array<keyof typeof input.toolSet> };
			}
			return undefined;
		},
		...(input.prepared.systemPrompt
			? { system: input.prepared.systemPrompt }
			: {}),
		...(Object.keys(input.providerOptions).length > 0
			? {
					providerOptions:
						input.providerOptions as unknown as StreamTextOptions["providerOptions"],
				}
			: {}),
		...(input.signal ? { abortSignal: input.signal } : {}),
		onError: () => {
			// The AI SDK logs errors to stderr by default. We surface failures through
			// streamed turn events so CLI output stays compact and consistent.
		},
		timeout: { chunkMs: 120_000 },
	} as StreamTextOptions;
}
