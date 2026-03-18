import { isApiLogEnabled, logApiEvent } from "./api-log.ts";
import {
	normalizeOpenAICompatibleToolCallInputs,
	sanitizeGeminiToolMessagesWithMetadata,
	stripOpenAIHistoryTransforms,
	stripToolRuntimeInputFields,
} from "./history-transforms.ts";
import { isAnthropicModelFamily } from "./model-routing.ts";
import { getCacheFamily } from "./provider-options.ts";
import { isAnthropicOAuth } from "./providers.ts";
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
	const pruned = applyContextPruning(normalised, pruningMode);

	// Only compute stats when they will actually be consumed:
	// - apiLogOn: logged for debugging
	// - pruning active + messages changed: used in "context-pruned" yield event
	const pruningActive = pruningMode !== "off";
	const needsStats = apiLogOn || pruningActive;

	let preStats: { messageCount: number; totalBytes: number };
	let postStats: { messageCount: number; totalBytes: number };

	if (!needsStats) {
		// pruning is off and API log is off — skip expensive serialisation
		const count = normalised.length;
		preStats = { messageCount: count, totalBytes: 0 };
		postStats = preStats;
	} else {
		preStats = apiLogOn
			? getMessageDiagnostics(normalised)
			: getMessageStats(normalised);
		if (apiLogOn) logApiEvent("turn context pre-prune", preStats);
		// Reuse preStats when pruning was a no-op (same array reference)
		postStats =
			pruned === normalised
				? preStats
				: apiLogOn
					? getMessageDiagnostics(pruned)
					: getMessageStats(pruned);
		if (apiLogOn) logApiEvent("turn context post-prune", postStats);
	}

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

	// 6. OAuth identity: Anthropic OAuth requires the Claude Code identity as
	//    a separate first system block so the API recognises the client.
	if (isAnthropicModelFamily(modelString) && isAnthropicOAuth()) {
		const ccIdentity =
			"You are Claude Code, Anthropic's official CLI for Claude.";
		const ccSystemMsg = {
			role: "system",
			content: ccIdentity,
			providerOptions: {
				anthropic: { cacheControl: { type: "ephemeral" } },
			},
		} as CoreMessage;

		if (finalSystemPrompt) {
			// System prompt hasn't been inlined — prepend identity as separate
			// system message so the AI SDK sends two blocks.
			finalMessages = [ccSystemMsg, ...finalMessages];
		} else {
			// System prompt was inlined into messages by cache breakpoint annotation.
			// Insert the identity block before the existing system message.
			const sysIdx = finalMessages.findIndex((m) => m.role === "system");
			if (sysIdx >= 0) {
				finalMessages = [
					...finalMessages.slice(0, sysIdx),
					ccSystemMsg,
					...finalMessages.slice(sysIdx),
				];
			} else {
				finalMessages = [ccSystemMsg, ...finalMessages];
			}
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
