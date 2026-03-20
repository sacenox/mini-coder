import { pruneMessages } from "ai";
import { isRecord } from "./history/shared.ts";
import type { CoreMessage } from "./turn.ts";

interface ToolContributorStats {
  toolName: string;
  count: number;
  bytes: number;
}

interface RoleStats {
  count: number;
  bytes: number;
}

interface MessageDiagnostics {
  messageCount: number;
  totalBytes: number;
  roleBreakdown: Record<string, RoleStats>;
  toolResults: {
    count: number;
    bytes: number;
    topContributors: ToolContributorStats[];
  };
}

const DEFAULT_TOOL_RESULT_PAYLOAD_CAP_BYTES = 16 * 1024;

function getByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return JSON.stringify(String(value));
  }
}

/**
 * Lightweight alternative to getMessageDiagnostics that computes only the
 * fields needed for the context-pruned yield event (no roleBreakdown / tool
 * contributor maps). Used when the API log is disabled.
 */
export function getMessageStats(messages: CoreMessage[]): {
  messageCount: number;
  totalBytes: number;
} {
  let totalBytes = 0;
  for (const m of messages) totalBytes += getByteLength(safeStringify(m));
  return { messageCount: messages.length, totalBytes };
}

export function getMessageDiagnostics(
  messages: CoreMessage[],
): MessageDiagnostics {
  const roleBreakdown: Record<string, RoleStats> = {};
  const toolContributorMap = new Map<
    string,
    { count: number; bytes: number }
  >();
  let totalBytes = 0;
  let toolResultBytes = 0;
  let toolResultCount = 0;

  for (const message of messages) {
    const serializedMessage = safeStringify(message);
    const messageBytes = getByteLength(serializedMessage);
    totalBytes += messageBytes;

    const role = message.role;
    const roleStats = roleBreakdown[role] ?? { count: 0, bytes: 0 };
    roleStats.count += 1;
    roleStats.bytes += messageBytes;
    roleBreakdown[role] = roleStats;

    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (!isRecord(part)) continue;
      const partType = (part as { type?: unknown }).type;
      if (partType !== "tool-result") continue;
      toolResultCount += 1;

      const partRecord = part as Record<string, unknown>;
      const rawToolName = partRecord.toolName;
      const toolName =
        typeof rawToolName === "string" && rawToolName.length > 0
          ? rawToolName
          : "unknown";
      let payload: unknown = null;
      if ("output" in partRecord) payload = partRecord.output;
      else if ("result" in partRecord) payload = partRecord.result;
      const payloadBytes = getByteLength(safeStringify(payload));
      toolResultBytes += payloadBytes;

      const existing = toolContributorMap.get(toolName) ?? {
        count: 0,
        bytes: 0,
      };
      existing.count += 1;
      existing.bytes += payloadBytes;
      toolContributorMap.set(toolName, existing);
    }
  }

  const topContributors = [...toolContributorMap.entries()]
    .map(([toolName, stats]) => ({
      toolName,
      count: stats.count,
      bytes: stats.bytes,
    }))
    .sort((a, b) =>
      b.bytes === a.bytes
        ? a.toolName.localeCompare(b.toolName)
        : b.bytes - a.bytes,
    )
    .slice(0, 5);

  return {
    messageCount: messages.length,
    totalBytes,
    roleBreakdown,
    toolResults: {
      count: toolResultCount,
      bytes: toolResultBytes,
      topContributors,
    },
  };
}

export function applyContextPruning(messages: CoreMessage[]): CoreMessage[] {
  return pruneMessages({
    messages,
    reasoning: "before-last-message",
    toolCalls: "before-last-40-messages",
    emptyMessages: "remove",
  }) as CoreMessage[];
}

/**
 * Step-level pruning designed to preserve the Anthropic prompt cache.
 *
 * Two differences from applyContextPruning:
 *
 * 1. reasoning: "none" — keeps the model's chain-of-thought intact during
 *    the turn. Without this, reasoning from every previous step is stripped
 *    (the last message is always a tool result, so "before-last-message"
 *    exempts nothing), causing the model to lose its plan and loop.
 *
 * 2. The tool-call window is anchored to the boundary that prepareTurnMessages
 *    already established. prepareTurnMessages pruned with before-last-40 at
 *    the initial message count, stripping tool calls from messages 0 through
 *    (initialCount - 40). By using a window of 40 + newMessageCount, we keep
 *    that boundary fixed: the initial prefix stays byte-identical across
 *    steps, so the Anthropic cache hit covers the full conversation history
 *    up to the user's message.
 *
 * Falls back to full context pruning when the conversation grows past
 * STEP_PRUNE_FALLBACK_THRESHOLD to prevent context-window overflow on
 * very long turns.
 */
const STEP_PRUNE_FALLBACK_THRESHOLD = 200;

export function applyStepPruning(
  messages: CoreMessage[],
  initialMessageCount: number,
): CoreMessage[] {
  if (messages.length > STEP_PRUNE_FALLBACK_THRESHOLD) {
    return applyContextPruning(messages);
  }
  const newMessageCount = Math.max(0, messages.length - initialMessageCount);
  return pruneMessages({
    messages,
    reasoning: "none",
    toolCalls: `before-last-${40 + newMessageCount}-messages`,
    emptyMessages: "remove",
  }) as CoreMessage[];
}

function compactHeadTail(
  serialized: string,
  maxChars = 4096,
): { head: string; tail: string } {
  const chars = Math.max(512, maxChars);
  const headLength = Math.floor(chars / 2);
  const tailLength = chars - headLength;
  return {
    head: serialized.slice(0, headLength),
    tail: serialized.slice(-tailLength),
  };
}

function wrapCompactedToolResultOutput(
  compactedPayload: Record<string, unknown>,
): unknown {
  return {
    type: "json",
    value: compactedPayload,
  };
}

export function compactToolResultPayloads(
  messages: CoreMessage[],
): CoreMessage[] {
  const capBytes = DEFAULT_TOOL_RESULT_PAYLOAD_CAP_BYTES;

  let mutated = false;
  const compacted = messages.map((message) => {
    if (message.role !== "tool" || !Array.isArray(message.content)) {
      return message;
    }

    let contentMutated = false;
    const nextContent = message.content.map((part) => {
      if (!isRecord(part)) return part;
      const partType = (part as { type?: unknown }).type;
      if (partType !== "tool-result") return part;

      let payload: unknown = null;
      if ("output" in part) payload = part.output;
      else if ("result" in part) payload = part.result;
      const serializedPayload = safeStringify(payload);
      const originalBytes = getByteLength(serializedPayload);
      if (originalBytes <= capBytes) return part;

      const { head, tail } = compactHeadTail(
        serializedPayload,
        Math.floor(capBytes / 2),
      );
      const compactedPayload = {
        truncated: true,
        originalBytes,
        strategy: "head-tail",
        head,
        tail,
      };

      contentMutated = true;
      if ("output" in part) {
        return {
          ...part,
          output: wrapCompactedToolResultOutput(compactedPayload),
        };
      }
      if ("result" in part) {
        return { ...part, result: compactedPayload };
      }
      return {
        ...part,
        output: wrapCompactedToolResultOutput(compactedPayload),
      };
    });

    if (!contentMutated) return message;
    mutated = true;
    return {
      ...message,
      content: nextContent as CoreMessage["content"],
    } as CoreMessage;
  });

  return mutated ? compacted : messages;
}

/**
 * Strip any existing Anthropic cache breakpoints from a message so we can
 * re-annotate cleanly without accumulating stale markers across steps.
 */
function stripCacheBreakpoint(msg: CoreMessage): CoreMessage {
  const anthropic = msg?.providerOptions?.anthropic as
    | Record<string, unknown>
    | undefined;
  if (!anthropic?.cacheControl) return msg;

  const { cacheControl: _, ...rest } = anthropic;
  const hasOtherKeys = Object.keys(rest).length > 0;
  const { anthropic: __, ...otherProviders } = msg.providerOptions as Record<
    string,
    unknown
  >;
  const hasOtherProviders = Object.keys(otherProviders).length > 0;

  return {
    ...msg,
    providerOptions: {
      ...(hasOtherProviders ? otherProviders : {}),
      ...(hasOtherKeys ? { anthropic: rest } : {}),
    },
  } as CoreMessage;
}

function withCacheBreakpoint(msg: CoreMessage): CoreMessage {
  return {
    ...msg,
    providerOptions: {
      ...(msg?.providerOptions ?? {}),
      anthropic: {
        ...((msg?.providerOptions?.anthropic as Record<string, unknown>) ?? {}),
        cacheControl: { type: "ephemeral" },
      },
    },
  } as CoreMessage;
}

/**
 * Add Anthropic ephemeral cache breakpoints to messages. Designed to run
 * per-step via middleware so breakpoints always track the conversation tail.
 *
 * Anthropic allows max 4 breakpoints per request. We reserve 1 for tool
 * caching (see annotateToolCaching), leaving 3 for messages:
 *   - First system message (stable prefix)
 *   - Last user message (stable within a turn — anchors the cached prefix)
 *   - Last non-system message (moving tail)
 *
 * By anchoring a breakpoint at the last user message, the full conversation
 * prefix up to the user's input is cached and reused across multi-step tool
 * loops. Only the new assistant/tool messages after it need re-processing.
 */
export function annotateAnthropicCacheBreakpoints(
  prompt: CoreMessage[],
): CoreMessage[] {
  // Strip existing breakpoints to prevent accumulation across steps
  const result = prompt.map(stripCacheBreakpoint);

  let firstSystemIdx = -1;
  let lastUserIdx = -1;
  let lastNonSystemIdx = -1;

  for (let i = 0; i < result.length; i++) {
    const role = result[i]?.role;
    if (role === "system") {
      if (firstSystemIdx === -1) firstSystemIdx = i;
    } else {
      lastNonSystemIdx = i;
      if (role === "user") lastUserIdx = i;
    }
  }

  // Annotate first system message (stable prefix)
  if (firstSystemIdx >= 0) {
    result[firstSystemIdx] = withCacheBreakpoint(
      result[firstSystemIdx] as CoreMessage,
    );
  }

  // Annotate last user message (stable within a turn)
  if (lastUserIdx >= 0) {
    result[lastUserIdx] = withCacheBreakpoint(
      result[lastUserIdx] as CoreMessage,
    );
  }

  // Annotate last non-system message (moving tail) — skip if same as lastUserIdx
  if (lastNonSystemIdx >= 0 && lastNonSystemIdx !== lastUserIdx) {
    result[lastNonSystemIdx] = withCacheBreakpoint(
      result[lastNonSystemIdx] as CoreMessage,
    );
  }

  return result;
}
