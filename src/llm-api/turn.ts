import { streamText, tool, stepCountIs, jsonSchema } from "ai";
import { z } from "zod";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLanguageModel = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModelMessage = any;
import type { TurnEvent, ToolDef } from "./types.ts";

const MAX_STEPS = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isZodSchema(s: unknown): boolean {
  // Zod schemas have a _def property; plain JSON Schema objects don't.
  return (
    s !== null &&
    typeof s === "object" &&
    "_def" in (s as object)
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCoreTool(def: ToolDef): any {
  // MCP tools pass raw JSON Schema objects; the AI SDK requires them to be
  // wrapped with jsonSchema(). Zod schemas are passed through as-is.
  const schema = isZodSchema(def.schema) ? def.schema : jsonSchema(def.schema);
  return tool({
    description: def.description,
    inputSchema: schema,
    execute: async (input: unknown) => {
      try {
        return await def.execute(input);
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
      }
    },
  });
}

// ─── Main turn function ───────────────────────────────────────────────────────

/**
 * Run a single agent turn against the model.
 *
 * Yields TurnEvents as they arrive, then yields a final TurnCompleteEvent
 * (or TurnErrorEvent on failure).
 */
export async function* runTurn(options: {
  model: AnyLanguageModel;
  messages: AnyModelMessage[];
  tools: ToolDef[];
  systemPrompt?: string;
  signal?: AbortSignal;
}): AsyncGenerator<TurnEvent> {
  const { model, messages, tools, systemPrompt, signal } = options;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolSet: Record<string, any> = {};
  for (const def of tools) {
    toolSet[def.name] = toCoreTool(def);
  }

  let inputTokens = 0;
  let outputTokens = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newMessages: any[] = [];

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const streamOpts: any = {
      model,
      messages,
      tools: toolSet,
      stopWhen: stepCountIs(MAX_STEPS),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onStepFinish: (step: any) => {
        inputTokens += (step.usage?.inputTokens as number) ?? 0;
        outputTokens += (step.usage?.outputTokens as number) ?? 0;
        if (step.response?.messages) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          newMessages.push(...(step.response.messages as any[]));
        }
      },
    };
    if (systemPrompt) streamOpts.system = systemPrompt;
    if (signal) streamOpts.abortSignal = signal;

    const result = streamText(streamOpts);

    // Stream events
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const chunk of (result as any).fullStream) {
      if (signal?.aborted) break;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = chunk as any;

      switch (c.type) {
        case "text-delta":
          // AI SDK v6: property is `text`, not `textDelta`
          yield { type: "text-delta", delta: (c.text ?? c.textDelta ?? "") as string };
          break;

        case "tool-call":
          yield {
            type: "tool-call-start",
            toolCallId: c.toolCallId as string,
            toolName: c.toolName as string,
            // AI SDK v6: property is `input`, not `args`
            args: c.input ?? c.args,
          };
          break;

        case "tool-result":
          yield {
            type: "tool-result",
            toolCallId: c.toolCallId as string,
            toolName: c.toolName as string,
            // AI SDK v6: property is `output`, not `result`
            result: c.output ?? c.result,
            isError: false,
          };
          break;

        case "tool-error":
          yield {
            type: "tool-result",
            toolCallId: c.toolCallId as string,
            toolName: c.toolName as string,
            result: c.error ?? "Tool execution failed",
            isError: true,
          };
          break;

        case "error":
          throw c.error instanceof Error
            ? c.error
            : new Error(String(c.error));
      }
    }

    yield {
      type: "turn-complete",
      inputTokens,
      outputTokens,
      // Pass raw ModelMessage objects — no conversion; they are fed back to
      // streamText on the next turn and must stay in their original shape.
      messages: newMessages,
    };
  } catch (err) {
    yield {
      type: "turn-error",
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

// ─── Message builder helpers ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function userMessage(text: string): any {
  return { role: "user", content: text };
}

export { z };
