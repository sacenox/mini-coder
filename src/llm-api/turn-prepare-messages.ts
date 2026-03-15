import { isApiLogEnabled, logApiEvent } from "./api-log.ts";
import {
	normalizeOpenAICompatibleToolCallInputs,
	sanitizeGeminiToolMessagesWithMetadata,
	stripOpenAIHistoryTransforms,
	stripToolRuntimeInputFields,
} from "./history-transforms.ts";
import { getCacheFamily } from "./provider-options.ts";
import type { CoreMessage } from "./turn.ts";
import {
	annotateAnthropicCacheBreakpoints,
	applyContextPruning,
	type ContextPruningMode,
	compactToolResultPayloads,
	getMessageDiagnostics,
	getMessageStats,
} from "./turn-context.ts";

interface PreparedMessages {
	messages: CoreMessage[];
	systemPrompt: string | undefined;
	/** True if context pruning removed any messages. */
	pruned: boolean;
	prePruneMessageCount: number;
	prePruneTotalBytes: number;
	postPruneMessageCount: number;
	postPruneTotalBytes: number;
}

/**
 * Apply provider-specific history sanitisation, context pruning, and
 * payload compaction. Returns the messages ready to send to the model.
 */
export function prepareTurnMessages(input: {
	messages: CoreMessage[];
	modelString: string;
	toolCount: number;
	systemPrompt: string | undefined;
	pruningMode: ContextPruningMode;
	toolResultPayloadCapBytes: number;
	promptCachingEnabled: boolean;
}): PreparedMessages {
	const {
		messages,
		modelString,
		toolCount,
		systemPrompt,
		pruningMode,
		toolResultPayloadCapBytes,
		promptCachingEnabled,
	} = input;

	const apiLogOn = isApiLogEnabled();

	// 1. Strip runtime-only tool input fields before provider-specific sanitisation.
	const strippedRuntimeToolFields = stripToolRuntimeInputFields(messages);
	if (strippedRuntimeToolFields !== messages && apiLogOn) {
		logApiEvent("runtime tool input fields stripped", { modelString });
	}

	// 2. Provider-specific sanitisation
	const geminiResult = sanitizeGeminiToolMessagesWithMetadata(
		strippedRuntimeToolFields,
		modelString,
		toolCount > 0,
	);
	if (geminiResult.repaired && apiLogOn) {
		logApiEvent("gemini tool history repaired", {
			modelString,
			reason: geminiResult.reason,
			repairedFromIndex: geminiResult.repairedFromIndex,
			droppedMessageCount: geminiResult.droppedMessageCount,
			tailOnlyAffected: geminiResult.tailOnlyAffected,
		});
	}

	const openaiStripped = stripOpenAIHistoryTransforms(
		geminiResult.messages,
		modelString,
	);
	if (openaiStripped !== geminiResult.messages && apiLogOn) {
		logApiEvent("openai history transforms applied", { modelString });
	}

	const normalised = normalizeOpenAICompatibleToolCallInputs(
		openaiStripped,
		modelString,
	);
	if (normalised !== openaiStripped && apiLogOn) {
		logApiEvent("openai-compatible tool input normalized", { modelString });
	}

	// 3. Context pruning
	const preStats = apiLogOn
		? getMessageDiagnostics(normalised)
		: getMessageStats(normalised);
	if (apiLogOn) logApiEvent("turn context pre-prune", preStats);

	const pruned = applyContextPruning(normalised, pruningMode);

	const postStats = apiLogOn
		? getMessageDiagnostics(pruned)
		: getMessageStats(pruned);
	if (apiLogOn) logApiEvent("turn context post-prune", postStats);

	// 4. Payload compaction
	const compacted = compactToolResultPayloads(
		pruned,
		toolResultPayloadCapBytes,
	);
	if (compacted !== pruned && apiLogOn) {
		logApiEvent("turn context post-compaction", {
			capBytes: toolResultPayloadCapBytes,
			diagnostics: getMessageDiagnostics(compacted),
		});
	}

	// 5. Anthropic prompt caching breakpoints
	let finalMessages = compacted;
	let finalSystemPrompt = systemPrompt;

	const cacheFamily = getCacheFamily(modelString);
	if (cacheFamily === "anthropic" && promptCachingEnabled) {
		const annotated = annotateAnthropicCacheBreakpoints(
			compacted,
			systemPrompt,
		);
		finalMessages = annotated.messages;
		finalSystemPrompt = annotated.systemPrompt;
		if (apiLogOn) {
			logApiEvent("Anthropic prompt caching", annotated.diagnostics);
		}
	}

	const wasPruned =
		(pruningMode === "balanced" || pruningMode === "aggressive") &&
		(postStats.messageCount < preStats.messageCount ||
			postStats.totalBytes < preStats.totalBytes);

	return {
		messages: finalMessages,
		systemPrompt: finalSystemPrompt,
		pruned: wasPruned,
		prePruneMessageCount: preStats.messageCount,
		prePruneTotalBytes: preStats.totalBytes,
		postPruneMessageCount: postStats.messageCount,
		postPruneTotalBytes: postStats.totalBytes,
	};
}
