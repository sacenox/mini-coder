// Stream normalization strategy:
// Providers emit tool calls and text in inconsistent ways. StreamToolCallTracker
// collects fragmented tool-call deltas into complete calls before yielding events,
// and synthesises missing tool-call IDs (OpenAI streaming sometimes omits them).
// StreamTextPhaseTracker filters out non-reasoning "commentary" text phases that
// some providers (OpenAI) emit alongside tool calls, preventing duplicate output.
import type { FlexibleSchema, StepResult } from "ai";
import { dynamicTool, jsonSchema, type streamText } from "ai";
import { normalizeUnknownError } from "./error-utils.ts";
import { isRecord } from "./history/shared.ts";
import { isAnthropicModelFamily } from "./model-routing.ts";
import {
  extractToolArgs,
  hasRenderableToolArgs,
  mapStreamChunkToTurnEvent,
  shouldLogStreamChunk,
} from "./turn-stream-events.ts";
import type { ToolDef, TurnEvent } from "./types.ts";

type StreamTextOptions = Parameters<typeof streamText>[0];
type CoreMessage = NonNullable<StreamTextOptions["messages"]>[number];
type ToolSet = NonNullable<StreamTextOptions["tools"]>;
type ToolEntry = ToolSet extends Record<string, infer T> ? T : never;

export type StreamTextResultFull = ReturnType<typeof streamText> & {
  fullStream: AsyncIterable<{ type?: string; [key: string]: unknown }>;
  response: Promise<{ messages?: CoreMessage[] }>;
};

interface TurnState {
  inputTokens: number;
  outputTokens: number;
  contextTokens: number;
  partialMessages: CoreMessage[];
}

interface TurnStateTracker {
  onStepFinish: (step: StepResult<ToolSet>) => void;
  getState: () => TurnState;
}

function isZodSchema(s: unknown): boolean {
  return s !== null && typeof s === "object" && "_def" in (s as object);
}

function toCoreTool(def: ToolDef): ReturnType<typeof dynamicTool> {
  const schema = isZodSchema(def.schema)
    ? (def.schema as FlexibleSchema<unknown>)
    : jsonSchema(def.schema);
  return dynamicTool({
    description: def.description,
    inputSchema: schema,
    execute: async (input: unknown, { abortSignal }) => {
      try {
        return await def.execute(
          input,
          abortSignal ? { signal: abortSignal } : undefined,
        );
      } catch (err) {
        throw normalizeUnknownError(err);
      }
    },
  });
}

export function buildToolSet(tools: ToolDef[]): ToolSet {
  const toolSet = {} as ToolSet;
  for (const def of tools) {
    (toolSet as Record<string, ToolEntry>)[def.name] = toCoreTool(def);
  }
  return toolSet;
}

/**
 * Add an Anthropic cache breakpoint to the last tool so the system+tools
 * prefix is cached as a unit. This helps exceed the per-model minimum
 * cacheable prefix (e.g. 4096 tokens for Opus).
 */
export function annotateToolCaching(
  toolSet: ToolSet,
  modelString: string,
): ToolSet {
  if (!isAnthropicModelFamily(modelString)) return toolSet;
  const keys = Object.keys(toolSet);
  if (keys.length === 0) return toolSet;
  const lastKey = keys.at(-1) as string;
  const lastTool = (toolSet as Record<string, ToolEntry>)[lastKey] as ToolEntry;
  return {
    ...toolSet,
    [lastKey]: {
      ...lastTool,
      providerOptions: {
        ...(lastTool.providerOptions ?? {}),
        anthropic: {
          ...((lastTool.providerOptions?.anthropic as Record<
            string,
            unknown
          >) ?? {}),
          cacheControl: { type: "ephemeral" },
        },
      },
    },
  } as ToolSet;
}

export function createTurnStateTracker(opts: {
  onStepLog: (entry: {
    finishReason: string | null | undefined;
    usage: unknown;
  }) => void;
}): TurnStateTracker {
  let inputTokens = 0;
  let outputTokens = 0;
  let contextTokens = 0;
  let partialMessages: CoreMessage[] = [];

  return {
    onStepFinish: (step: StepResult<ToolSet>) => {
      opts.onStepLog({
        finishReason: step.finishReason,
        usage: step.usage,
      });
      inputTokens += step.usage?.inputTokens ?? 0;
      outputTokens += step.usage?.outputTokens ?? 0;
      contextTokens = step.usage?.inputTokens ?? contextTokens;

      const s = step as unknown as {
        response?: { messages?: CoreMessage[] };
        messages?: CoreMessage[];
      };
      partialMessages = s.response?.messages ?? s.messages ?? partialMessages;
    },
    getState: () => ({
      inputTokens,
      outputTokens,
      contextTokens,
      partialMessages,
    }),
  };
}

interface StreamToolChunk {
  type?: string;
  toolName?: unknown;
  toolCallId?: unknown;
  [key: string]: unknown;
}

interface StreamTextChunk {
  type?: string;
  id?: unknown;
  providerMetadata?: unknown;
  providerOptions?: unknown;
  [key: string]: unknown;
}

const TOOL_RESULT_CHUNK_TYPES = new Set(["tool-result", "tool-error"]);

function normalizeStringId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function normalizeToolName(raw: unknown): string {
  if (typeof raw !== "string") return "tool";
  const trimmed = raw.trim();
  return trimmed || "tool";
}

function getOpenAITextPhase(
  chunk: StreamTextChunk,
): "commentary" | "final_answer" | null {
  let providerData: Record<string, unknown> | null = null;
  if (isRecord(chunk.providerMetadata)) providerData = chunk.providerMetadata;
  else if (isRecord(chunk.providerOptions))
    providerData = chunk.providerOptions;
  if (!providerData) return null;
  const openai = providerData.openai;
  if (!isRecord(openai)) return null;
  return openai.phase === "commentary" || openai.phase === "final_answer"
    ? openai.phase
    : null;
}

type StreamTextRoute = "skip" | "text" | "reasoning";

function extractTextDelta(chunk: StreamTextChunk): string {
  if (typeof chunk.text === "string") return chunk.text;
  if (typeof chunk.textDelta === "string") return chunk.textDelta;
  if (typeof chunk.delta === "string") return chunk.delta;
  return "";
}

class StreamTextPhaseTracker {
  private phaseByTextPartId = new Map<string, "commentary" | "final_answer">();
  private sawExplicitReasoningThisStep = false;

  route(chunk: StreamTextChunk): StreamTextRoute {
    const textPartId = normalizeStringId(chunk.id);
    switch (chunk.type) {
      case "start-step": {
        this.sawExplicitReasoningThisStep = false;
        return "text";
      }
      case "reasoning-start":
      case "reasoning-delta":
      case "reasoning-end":
      case "reasoning": {
        this.sawExplicitReasoningThisStep = true;
        return "text";
      }
      case "text-start": {
        const phase = getOpenAITextPhase(chunk);
        if (textPartId && phase) this.phaseByTextPartId.set(textPartId, phase);
        return "skip";
      }
      case "text-end": {
        if (textPartId) this.phaseByTextPartId.delete(textPartId);
        return "skip";
      }
      case "text-delta": {
        if (!textPartId) return "text";
        if (this.phaseByTextPartId.get(textPartId) !== "commentary") {
          return "text";
        }
        return this.sawExplicitReasoningThisStep ? "skip" : "reasoning";
      }
      default:
        return "text";
    }
  }
}

function mapCommentaryChunkToTurnEvent(
  chunk: StreamTextChunk,
): TurnEvent | null {
  if (chunk.type !== "text-delta") return null;
  return {
    type: "reasoning-delta",
    delta: extractTextDelta(chunk),
  };
}

class StreamToolCallTracker {
  private syntheticCount = 0;
  private pendingByTool = new Map<string, string[]>();
  private deferredStartsByTool = new Map<string, number>();

  prepare(chunk: StreamToolChunk): {
    chunk: StreamToolChunk;
    suppressTurnEvent: boolean;
  } {
    const type = chunk.type;
    if (!type) {
      return { chunk, suppressTurnEvent: false };
    }

    if (type === "tool-input-start") {
      const toolName = normalizeToolName(chunk.toolName);
      const toolCallId = normalizeStringId(chunk.toolCallId);
      const args = extractToolArgs(chunk);
      if (!hasRenderableToolArgs(args)) {
        if (!toolCallId) {
          this.trackDeferredStart(toolName);
          return { chunk, suppressTurnEvent: true };
        }
        return { chunk, suppressTurnEvent: false };
      }
      return {
        chunk: this.trackRenderableStart(chunk, toolName, toolCallId),
        suppressTurnEvent: false,
      };
    }

    if (type === "tool-call") {
      const toolName = normalizeToolName(chunk.toolName);
      this.consumeDeferredStart(toolName);
      return {
        chunk: this.trackRenderableStart(
          chunk,
          toolName,
          normalizeStringId(chunk.toolCallId),
        ),
        suppressTurnEvent: false,
      };
    }

    if (TOOL_RESULT_CHUNK_TYPES.has(type)) {
      const toolName = normalizeToolName(chunk.toolName);
      const existingToolCallId = normalizeStringId(chunk.toolCallId);
      if (existingToolCallId) {
        this.consumeTracked(toolName, existingToolCallId);
        return { chunk, suppressTurnEvent: false };
      }
      const nextToolCallId =
        this.consumeNextTracked(toolName) ?? this.nextSyntheticToolCallId();
      return {
        chunk: { ...chunk, toolCallId: nextToolCallId },
        suppressTurnEvent: false,
      };
    }

    return { chunk, suppressTurnEvent: false };
  }

  private trackRenderableStart(
    chunk: StreamToolChunk,
    toolName: string,
    existingToolCallId: string | null,
  ): StreamToolChunk {
    const toolCallId = existingToolCallId ?? this.nextSyntheticToolCallId();
    this.trackStart(toolName, toolCallId);
    if (toolCallId === chunk.toolCallId) return chunk;
    return { ...chunk, toolCallId };
  }

  private nextSyntheticToolCallId(): string {
    this.syntheticCount += 1;
    return `synthetic-tool-call-${this.syntheticCount}`;
  }

  private trackStart(toolName: string, toolCallId: string): void {
    const pending = this.pendingByTool.get(toolName) ?? [];
    pending.push(toolCallId);
    this.pendingByTool.set(toolName, pending);
  }

  private trackDeferredStart(toolName: string): void {
    this.deferredStartsByTool.set(
      toolName,
      (this.deferredStartsByTool.get(toolName) ?? 0) + 1,
    );
  }

  private consumeDeferredStart(toolName: string): void {
    const count = this.deferredStartsByTool.get(toolName) ?? 0;
    if (count <= 0) return;
    if (count === 1) {
      this.deferredStartsByTool.delete(toolName);
      return;
    }
    this.deferredStartsByTool.set(toolName, count - 1);
  }

  private consumeTracked(toolName: string, toolCallId: string): void {
    const pending = this.pendingByTool.get(toolName);
    if (!pending || pending.length === 0) return;
    const idx = pending.indexOf(toolCallId);
    if (idx === -1) return;
    pending.splice(idx, 1);
    if (pending.length === 0) this.pendingByTool.delete(toolName);
  }

  private consumeNextTracked(toolName: string): string | null {
    const pending = this.pendingByTool.get(toolName);
    if (!pending || pending.length === 0) return null;
    const toolCallId = pending.shift() ?? null;
    if (pending.length === 0) this.pendingByTool.delete(toolName);
    return toolCallId;
  }
}

export async function* mapFullStreamToTurnEvents(
  stream: AsyncIterable<{ type?: string; [key: string]: unknown }>,
  opts: {
    onChunk?: (chunk: { type?: string; [key: string]: unknown }) => void;
    stepPruneQueue?: {
      removedMessageCount: number;
      removedBytes: number;
      beforeMessageCount: number;
      afterMessageCount: number;
      beforeTotalBytes: number;
      afterTotalBytes: number;
    }[];
  },
): AsyncGenerator<TurnEvent> {
  const toolCallTracker = new StreamToolCallTracker();
  const textPhaseTracker = new StreamTextPhaseTracker();
  for await (const originalChunk of stream) {
    // Drain step-pruning records before each new step so the user sees
    // the pruning notification before the step's output begins.
    if (originalChunk.type === "start-step" && opts.stepPruneQueue) {
      for (const rec of opts.stepPruneQueue.splice(0)) {
        yield { type: "context-pruned", ...rec };
      }
    }
    const prepared = toolCallTracker.prepare(originalChunk);
    const chunk = prepared.chunk;
    const route = textPhaseTracker.route(chunk);
    if (
      !prepared.suppressTurnEvent &&
      route !== "skip" &&
      shouldLogStreamChunk(chunk)
    ) {
      opts.onChunk?.(chunk);
    }
    if (prepared.suppressTurnEvent || route === "skip") continue;
    const event =
      route === "reasoning"
        ? mapCommentaryChunkToTurnEvent(chunk)
        : mapStreamChunkToTurnEvent(chunk);
    if (event) yield event;
  }
}
