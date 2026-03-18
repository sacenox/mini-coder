import { isApiLogEnabled, logApiEvent } from "./api-log.ts";
import {
	normalizeOpenAICompatibleToolCallInputs,
	sanitizeGeminiToolMessagesWithMetadata,
	stripOpenAIHistoryTransforms,
	stripToolRuntimeInputFields,
} from "./history-transforms.ts";
import { isAnthropicModelFamily } from "./model-routing.ts";
import { isAnthropicOAuth } from "./providers.ts";
import type { CoreMessage } from "./turn.ts";
import {
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
}): PreparedMessages {
	const {
		messages,
		modelString,
		toolCount,
		systemPrompt,
		pruningMode,
		toolResultPayloadCapBytes,
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
		if (pruned === normalised) postStats = preStats;
		else
			postStats = apiLogOn
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

	// 5. OAuth identity: Anthropic OAuth requires the Claude Code identity as
	//    the first system block so the API recognises the client. We inline
	//    both identity and system prompt as messages (identity first) so the
	//    SDK sends them in the correct order on the wire.
	let finalMessages = compacted;
	let finalSystemPrompt = systemPrompt;

	if (isAnthropicModelFamily(modelString) && isAnthropicOAuth()) {
		const ccIdentity =
			"You are Claude Code, Anthropic's official CLI for Claude.";
		const systemMessages: CoreMessage[] = [
			{ role: "system", content: ccIdentity } as CoreMessage,
		];
		if (finalSystemPrompt) {
			systemMessages.push({
				role: "system",
				content: finalSystemPrompt,
			} as CoreMessage);
			finalSystemPrompt = undefined;
		}
		finalMessages = [...systemMessages, ...finalMessages];
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
