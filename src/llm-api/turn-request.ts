import { type streamText, wrapLanguageModel } from "ai";

import { isAnthropicModelFamily } from "./model-routing.ts";
import type { ThinkingEffort } from "./provider-options.ts";
import { annotateAnthropicCacheBreakpoints } from "./turn-context.ts";
import type { ContextPruningMode } from "./turn-context.ts";
import { prepareTurnMessages } from "./turn-prepare-messages.ts";
import { buildTurnProviderOptions } from "./turn-provider-options.ts";

type StreamTextOptions = Parameters<typeof streamText>[0];
type CoreMessage = NonNullable<StreamTextOptions["messages"]>[number];
type CoreModel = StreamTextOptions["model"];
type ToolSet = NonNullable<StreamTextOptions["tools"]>;

const continueUntilModelStops: NonNullable<
	StreamTextOptions["stopWhen"]
> = () => false;

interface BuildTurnPreparationInput {
	modelString: string;
	messages: CoreMessage[];
	thinkingEffort: ThinkingEffort | undefined;
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
	});

	const prepared = prepareTurnMessages({
		messages: input.messages,
		modelString: input.modelString,
		toolCount: input.toolCount,
		systemPrompt: input.systemPrompt,
		pruningMode: input.pruningMode,
		toolResultPayloadCapBytes: input.toolResultPayloadCapBytes,
	});

	return { providerOptionsResult, prepared };
}

interface BuildStreamTextRequestInput {
	model: CoreModel;
	modelString: string;
	prepared: ReturnType<typeof prepareTurnMessages>;
	toolSet: ToolSet;
	onStepFinish: NonNullable<StreamTextOptions["onStepFinish"]>;
	signal: AbortSignal | undefined;
	providerOptions: Record<string, unknown>;
}

export function buildStreamTextRequest(
	input: BuildStreamTextRequestInput,
): StreamTextOptions {
	// Wrap the model with caching middleware for Anthropic models.
	// This runs on every step so the cache breakpoints always track the tail.
	const model = isAnthropicModelFamily(input.modelString)
		? wrapLanguageModel({
				model: input.model,
				middleware: [
					{
						transformParams: async ({ params }) => ({
							...params,
							prompt: annotateAnthropicCacheBreakpoints(
								params.prompt as CoreMessage[],
							) as typeof params.prompt,
						}),
					},
				],
			})
		: input.model;

	return {
		model,
		maxOutputTokens: 16384,
		messages: input.prepared.messages,
		tools: input.toolSet,
		stopWhen: continueUntilModelStops,
		onStepFinish: input.onStepFinish,
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
