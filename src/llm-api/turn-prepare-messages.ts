import { getLogContext, logApiEvent } from "../logging/context.ts";
import {
  normalizeOpenAICompatibleToolCallInputs,
  sanitizeGeminiToolMessagesWithMetadata,
  stripOpenAIHistoryTransforms,
  stripToolRuntimeInputFields,
} from "./history-transforms.ts";
import { parseModelString } from "./model-routing.ts";
import { isAnthropicOAuth } from "./providers.ts";
import type { CoreMessage } from "./turn.ts";
import {
  applyContextPruning,
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
}): PreparedMessages {
  const { messages, modelString, toolCount, systemPrompt } = input;

  const apiLogOn = getLogContext() !== null;

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
  const pruned = applyContextPruning(normalised);

  let preStats: { messageCount: number; totalBytes: number };
  let postStats: { messageCount: number; totalBytes: number };

  if (!apiLogOn) {
    preStats = getMessageStats(normalised);
    if (pruned === normalised) postStats = preStats;
    else postStats = getMessageStats(pruned);
  } else {
    preStats = getMessageDiagnostics(normalised);
    logApiEvent("turn context pre-prune", preStats);
    if (pruned === normalised) postStats = preStats;
    else postStats = getMessageDiagnostics(pruned);
    logApiEvent("turn context post-prune", postStats);
  }

  // 4. Payload compaction
  const compacted = compactToolResultPayloads(pruned);
  if (compacted !== pruned && apiLogOn) {
    logApiEvent("turn context post-compaction", {
      diagnostics: getMessageDiagnostics(compacted),
    });
  }

  // 5. OAuth identity: Anthropic OAuth requires the Claude Code identity as
  //    the first system block so the API recognises the client. We inline
  //    both identity and system prompt as messages (identity first) so the
  //    SDK sends them in the correct order on the wire.
  let finalMessages = compacted;
  let finalSystemPrompt = systemPrompt;
  const { provider } = parseModelString(modelString);

  if (provider === "anthropic" && isAnthropicOAuth()) {
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

  const wasPruned = postStats.messageCount < preStats.messageCount;

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
