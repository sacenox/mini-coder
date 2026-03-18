import { isRecord } from "./history/shared.ts";
import { isOpenAIGPT } from "./history-transforms.ts";
import {
	getCacheFamily,
	getCachingProviderOptions,
	getThinkingProviderOptions,
	type ThinkingEffort,
} from "./provider-options.ts";

function mergeDeep(
	target: Record<string, unknown>,
	source: Record<string, unknown>,
): Record<string, unknown> {
	const output: Record<string, unknown> = { ...target };
	for (const key in source) {
		const sVal = source[key];
		const tVal = target[key];
		output[key] =
			isRecord(sVal) && isRecord(tVal) ? { ...tVal, ...sVal } : sVal;
	}
	return output;
}

interface BuildTurnProviderOptionsInput {
	modelString: string;
	thinkingEffort: ThinkingEffort | undefined;
	promptCachingEnabled: boolean;
	openaiPromptCacheRetention: "in_memory" | "24h";
	googleCachedContent: string | null;
	toolCount: number;
	hasSystemPrompt: boolean;
}

interface TurnProviderOptionsResult {
	cacheFamily: ReturnType<typeof getCacheFamily>;
	thinkingOpts: Record<string, unknown> | null;
	cacheOpts: Record<string, unknown> | null;
	providerOptions: Record<string, unknown>;
	reasoningSummaryRequested: boolean;
}

export function buildTurnProviderOptions(
	input: BuildTurnProviderOptionsInput,
): TurnProviderOptionsResult {
	const {
		modelString,
		thinkingEffort,
		promptCachingEnabled,
		openaiPromptCacheRetention,
		googleCachedContent,
		toolCount,
		hasSystemPrompt,
	} = input;

	const thinkingOpts = thinkingEffort
		? getThinkingProviderOptions(modelString, thinkingEffort)
		: null;

	const reasoningSummaryRequested =
		isRecord(thinkingOpts) &&
		isRecord(thinkingOpts.openai) &&
		typeof thinkingOpts.openai.reasoningSummary === "string";

	const cacheFamily = getCacheFamily(modelString);
	const cacheOpts = getCachingProviderOptions(modelString, {
		enabled: promptCachingEnabled,
		openaiRetention: openaiPromptCacheRetention,
		googleCachedContent,
		googleExplicitCachingCompatible: toolCount === 0 && !hasSystemPrompt,
	});

	const baseProviderOpts = {
		...(thinkingOpts ?? {}),
		...(isOpenAIGPT(modelString)
			? {
					openai: {
						store: false,
						...(isRecord(thinkingOpts?.openai)
							? (thinkingOpts.openai as object)
							: {}),
					},
				}
			: {}),
	};

	const providerOptions = cacheOpts
		? mergeDeep(baseProviderOpts, cacheOpts)
		: baseProviderOpts;

	return {
		cacheFamily,
		thinkingOpts,
		cacheOpts,
		providerOptions,
		reasoningSummaryRequested,
	};
}
