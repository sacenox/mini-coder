import type { StepResult } from "ai";
import { stepCountIs, streamText } from "ai";
import { isApiLogEnabled, logApiEvent } from "./api-log.ts";
import {
	getReasoningDeltaFromStreamChunk,
	isOpenAIGPT,
	normalizeOpenAICompatibleToolCallInputs,
	sanitizeGeminiToolMessages,
	sanitizeGeminiToolMessagesWithMetadata,
	stripGPTCommentaryFromHistory,
	stripOpenAIHistoryTransforms,
	stripOpenAIItemIdsFromHistory,
} from "./history-transforms.ts";
import {
	getCacheFamily,
	getCachingProviderOptions,
	getThinkingProviderOptions,
	type ThinkingEffort,
} from "./providers.ts";
import {
	annotateAnthropicCacheBreakpoints,
	applyContextPruning,
	type ContextPruningMode,
	compactToolResultPayloads,
	DEFAULT_TOOL_RESULT_PAYLOAD_CAP_BYTES,
	getMessageDiagnostics,
	getMessageStats,
} from "./turn-context.ts";
import {
	mapStreamChunkToTurnEvent,
	shouldLogStreamChunk,
} from "./turn-stream-events.ts";
import { toCoreTool } from "./turn-tools.ts";
import type { ToolDef, TurnEvent } from "./types.ts";

type StreamTextOptions = Parameters<typeof streamText>[0];
export type CoreMessage = NonNullable<StreamTextOptions["messages"]>[number];
type CoreModel = StreamTextOptions["model"];
type ToolSet = NonNullable<StreamTextOptions["tools"]>;
type ToolEntry = ToolSet extends Record<string, infer T> ? T : never;

type StreamTextResult = ReturnType<typeof streamText>;
type StreamTextResultFull = StreamTextResult & {
	fullStream: AsyncIterable<{ type?: string; [key: string]: unknown }>;
	response: Promise<{ messages?: CoreMessage[] }>;
};

const MAX_STEPS = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

const mergeDeep = (
	target: Record<string, unknown>,
	source: Record<string, unknown>,
) => {
	const output: Record<string, unknown> = { ...target };
	for (const key in source) {
		const sVal = source[key];
		const tVal = target[key];
		if (isRecord(sVal) && isRecord(tVal)) {
			output[key] = { ...tVal, ...sVal };
		} else {
			output[key] = sVal;
		}
	}
	return output;
};

export {
	annotateAnthropicCacheBreakpoints,
	applyContextPruning,
	compactToolResultPayloads,
	type ContextPruningMode,
	getMessageDiagnostics,
	getReasoningDeltaFromStreamChunk,
	isOpenAIGPT,
	normalizeOpenAICompatibleToolCallInputs,
	sanitizeGeminiToolMessages,
	stripGPTCommentaryFromHistory,
	stripOpenAIItemIdsFromHistory,
};

/**
 * Run a single agent turn against the model.
 *
 * Yields TurnEvents as they arrive, then yields a final TurnCompleteEvent
 * (or TurnErrorEvent on failure).
 */
export async function* runTurn(options: {
	model: CoreModel;
	modelString: string;
	messages: CoreMessage[];
	tools: ToolDef[];
	systemPrompt?: string;
	signal?: AbortSignal;
	thinkingEffort?: ThinkingEffort;
	pruningMode?: ContextPruningMode;
	toolResultPayloadCapBytes?: number;
	promptCachingEnabled?: boolean;
	openaiPromptCacheRetention?: "in_memory" | "24h";
	googleCachedContent?: string | null;
}): AsyncGenerator<TurnEvent> {
	const {
		model,
		modelString,
		messages,
		tools,
		systemPrompt,
		signal,
		thinkingEffort,
		pruningMode = "balanced",
		promptCachingEnabled = true,
		openaiPromptCacheRetention = "in_memory",
		googleCachedContent = null,
		toolResultPayloadCapBytes = DEFAULT_TOOL_RESULT_PAYLOAD_CAP_BYTES,
	} = options;

	let stepCount = 0;
	const toolSet = {} as ToolSet;
	for (const def of tools) {
		(toolSet as Record<string, ToolEntry>)[def.name] = toCoreTool(def);
	}

	let inputTokens = 0;
	let outputTokens = 0;
	let contextTokens = 0;
	const partialState = { messages: [] as CoreMessage[] };

	try {
		const toolCount = Object.keys(toolSet).length;
		const thinkingOpts = thinkingEffort
			? getThinkingProviderOptions(modelString, thinkingEffort)
			: null;
		const reasoningSummaryRequested =
			isRecord(thinkingOpts) &&
			isRecord(thinkingOpts.openai) &&
			typeof thinkingOpts.openai.reasoningSummary === "string";
		logApiEvent("turn start", {
			modelString,
			messageCount: messages.length,
			reasoningSummaryRequested,
			pruningMode,
			toolResultPayloadCapBytes,
		});

		const geminiSanitizationResult = sanitizeGeminiToolMessagesWithMetadata(
			messages,
			modelString,
			toolCount > 0,
		);
		const geminiSanitizedMessages = geminiSanitizationResult.messages;
		if (geminiSanitizationResult.repaired) {
			logApiEvent("gemini tool history repaired", {
				modelString,
				reason: geminiSanitizationResult.reason,
				repairedFromIndex: geminiSanitizationResult.repairedFromIndex,
				droppedMessageCount: geminiSanitizationResult.droppedMessageCount,
				tailOnlyAffected: geminiSanitizationResult.tailOnlyAffected,
			});
		}

		const openAIStrippedMessages = stripOpenAIHistoryTransforms(
			geminiSanitizedMessages,
			modelString,
		);
		if (
			openAIStrippedMessages !== geminiSanitizedMessages &&
			isApiLogEnabled()
		) {
			logApiEvent("openai history transforms applied", { modelString });
		}

		const compatNormalizedMessages = normalizeOpenAICompatibleToolCallInputs(
			openAIStrippedMessages,
			modelString,
		);
		if (
			compatNormalizedMessages !== openAIStrippedMessages &&
			isApiLogEnabled()
		) {
			logApiEvent("openai-compatible tool input normalized", { modelString });
		}

		const apiLogOn = isApiLogEnabled();
		const prePruneDiagnostics = apiLogOn
			? getMessageDiagnostics(compatNormalizedMessages)
			: getMessageStats(compatNormalizedMessages);
		if (apiLogOn) logApiEvent("turn context pre-prune", prePruneDiagnostics);

		const prunedMessages = applyContextPruning(
			compatNormalizedMessages,
			pruningMode,
		);
		const postPruneDiagnostics = apiLogOn
			? getMessageDiagnostics(prunedMessages)
			: getMessageStats(prunedMessages);
		if (apiLogOn) logApiEvent("turn context post-prune", postPruneDiagnostics);

		if (
			(pruningMode === "balanced" || pruningMode === "aggressive") &&
			(postPruneDiagnostics.messageCount < prePruneDiagnostics.messageCount ||
				postPruneDiagnostics.totalBytes < prePruneDiagnostics.totalBytes)
		) {
			yield {
				type: "context-pruned",
				mode: pruningMode,
				beforeMessageCount: prePruneDiagnostics.messageCount,
				afterMessageCount: postPruneDiagnostics.messageCount,
				removedMessageCount:
					prePruneDiagnostics.messageCount - postPruneDiagnostics.messageCount,
				beforeTotalBytes: prePruneDiagnostics.totalBytes,
				afterTotalBytes: postPruneDiagnostics.totalBytes,
				removedBytes:
					prePruneDiagnostics.totalBytes - postPruneDiagnostics.totalBytes,
			};
		}

		const turnMessages = compactToolResultPayloads(
			prunedMessages,
			toolResultPayloadCapBytes,
		);
		if (turnMessages !== prunedMessages && apiLogOn) {
			logApiEvent("turn context post-compaction", {
				capBytes: toolResultPayloadCapBytes,
				diagnostics: getMessageDiagnostics(turnMessages),
			});
		}

		const cacheFamily = getCacheFamily(modelString);
		const googleExplicitCachingCompatible = toolCount === 0 && !systemPrompt;
		const cacheOpts = getCachingProviderOptions(modelString, {
			enabled: promptCachingEnabled,
			openaiRetention: openaiPromptCacheRetention,
			googleCachedContent,
			googleExplicitCachingCompatible,
		});
		logApiEvent("prompt caching configured", {
			enabled: promptCachingEnabled,
			cacheFamily,
			cacheOpts,
			googleExplicitCachingCompatible,
		});

		let mergedProviderOptions = {
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

		if (cacheOpts) {
			mergedProviderOptions = mergeDeep(mergedProviderOptions, cacheOpts);
		}

		let finalMessages = turnMessages;
		let finalSystemPrompt = systemPrompt;

		if (cacheFamily === "anthropic" && promptCachingEnabled) {
			const annotated = annotateAnthropicCacheBreakpoints(
				turnMessages,
				systemPrompt,
			);
			finalMessages = annotated.messages;
			finalSystemPrompt = annotated.systemPrompt;
			logApiEvent("Anthropic prompt caching", annotated.diagnostics);
		}

		const streamOpts: StreamTextOptions = {
			model,
			messages: finalMessages,
			tools: toolSet,
			stopWhen: stepCountIs(MAX_STEPS),
			onStepFinish: (step: StepResult<ToolSet>) => {
				logApiEvent("step finish", {
					stepNumber: stepCount + 1,
					finishReason: step.finishReason,
					usage: step.usage,
				});
				inputTokens += step.usage?.inputTokens ?? 0;
				outputTokens += step.usage?.outputTokens ?? 0;
				contextTokens = step.usage?.inputTokens ?? contextTokens;
				stepCount++;

				const s = step as unknown as {
					response?: { messages?: CoreMessage[] };
					messages?: CoreMessage[];
				};
				partialState.messages =
					s.response?.messages ?? s.messages ?? partialState.messages;
			},
			prepareStep: ({ stepNumber }: { stepNumber: number }) => {
				if (stepNumber >= MAX_STEPS - 1) {
					return { activeTools: [] as Array<keyof typeof toolSet> };
				}
				return undefined;
			},
			...(finalSystemPrompt ? { system: finalSystemPrompt } : {}),
			...(Object.keys(mergedProviderOptions).length > 0
				? { providerOptions: mergedProviderOptions }
				: {}),
			...(signal ? { abortSignal: signal } : {}),
			timeout: { chunkMs: 120_000 },
		};

		const result = streamText(streamOpts) as StreamTextResultFull;
		result.response.catch(() => {});

		for await (const chunk of result.fullStream) {
			const streamChunk = chunk as Record<string, unknown> & { type?: string };
			if (shouldLogStreamChunk(streamChunk)) {
				logApiEvent("stream chunk", {
					type: streamChunk.type,
					toolCallId: streamChunk.toolCallId,
					toolName: streamChunk.toolName,
					isError: streamChunk.isError,
					hasArgs: "args" in streamChunk || "input" in streamChunk,
					hasOutput: "output" in streamChunk || "result" in streamChunk,
				});
			}
			const event = mapStreamChunkToTurnEvent(streamChunk);
			if (event) yield event;
		}

		const newMessages = partialState.messages;
		logApiEvent("turn complete", {
			newMessagesCount: newMessages.length,
			inputTokens,
			outputTokens,
		});

		yield {
			type: "turn-complete",
			inputTokens,
			outputTokens,
			contextTokens,
			messages: newMessages,
		};
	} catch (err) {
		logApiEvent("turn error", err);
		yield {
			type: "turn-error",
			error: err instanceof Error ? err : new Error(String(err)),
			partialMessages: partialState.messages,
		};
	}
}
