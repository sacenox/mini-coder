import {
  type Api,
  type AssistantMessage,
  type JsonObject,
  type Message,
  type Model,
  type Models,
  type ThinkingLevel,
  type Tool,
  type ToolCall,
  type ToolResultMessage,
  type UserMessage,
} from "@earendil-works/pi-ai";
import type { Session } from "./session.ts";
import { acceptsImages, executeTool, type ToolDetails, type ToolResult } from "./tools/index.ts";
import type { ToolName } from "./config.ts";

export type Phase = "preparing" | "waitingModel" | "streaming" | "runningTool" | "pausing" | "idle";

export type AgentEvent =
  | { type: "phase"; phase: Phase; detail?: string }
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "toolCall"; name: string; callId: string; arguments: JsonObject }
  | { type: "toolOutput"; name: string; callId: string; chunk: string }
  | { type: "toolResult"; name: string; callId: string; text: string; isError: boolean }
  | { type: "message"; message: AssistantMessage }
  | { type: "error"; message: string }
  | { type: "cancelled" }
  | { type: "complete" };

export interface Interaction {
  isPauseRequested(): boolean;
  clearPause(): void;
  requestSteering(): Promise<string>;
}

export const NO_INTERACTION: Interaction = {
  isPauseRequested: () => false,
  clearPause: () => {},
  requestSteering: async () => "",
};

/** What one turn needs, shared by both projections: the TUI and `--print`. */
export interface AgentOptions {
  models: Models;
  model: Model<Api>;
  systemPrompt: string;
  tools: Tool[];
  toolNames: ToolName[];
  thinkingEffort: ThinkingLevel;
  session: Session;
}

export interface AgentRun extends AgentOptions {
  messages: Message[];
  signal: AbortSignal;
  interaction: Interaction;
  onEvent: (event: AgentEvent) => void;
}

export async function runAgentTurn(run: AgentRun): Promise<void> {
  const { messages, session, signal, interaction, onEvent } = run;

  /** Appends a user message the model reads at the next step boundary. */
  const steer = (texts: string[]): void => {
    const content = texts.filter((text) => text.length > 0).join("\n");
    if (content.length === 0) return;
    const message: UserMessage = { role: "user", content, timestamp: Date.now() };
    messages.push(message);
    session.appendMessage(message);
  };

  /**
   * Returns the steering typed while paused, or ""; the caller decides where
   * it lands, because a user message between an assistant turn and its tool
   * results is rejected by the provider.
   */
  const pause = async (): Promise<string> => {
    if (!interaction.isPauseRequested()) return "";
    interaction.clearPause();
    onEvent({ type: "phase", phase: "pausing" });
    const steering = await interaction.requestSteering();
    onEvent({ type: "phase", phase: "idle" });
    return steering;
  };

  for (;;) {
    if (signal.aborted) {
      onEvent({ type: "cancelled" });
      return;
    }
    const steering = await pause();
    if (signal.aborted) {
      onEvent({ type: "cancelled" });
      return;
    }
    steer([steering]);

    onEvent({ type: "phase", phase: "preparing" });
    session.appendRequest({
      provider: run.model.provider,
      model: run.model.id,
      api: run.model.api,
      thinkingEffort: run.thinkingEffort,
      systemPrompt: run.systemPrompt,
      tools: run.tools,
    });

    onEvent({ type: "phase", phase: "waitingModel" });
    const context = { systemPrompt: run.systemPrompt, tools: run.tools, messages };
    let stream;
    try {
      stream = run.models.streamSimple(run.model, context, {
        reasoning: run.thinkingEffort,
        signal,
        sessionId: session.id ?? undefined,
      });
    } catch (error) {
      onEvent({ type: "error", message: (error as Error).message });
      return;
    }

    onEvent({ type: "phase", phase: "streaming" });
    try {
      for await (const event of stream) {
        if (event.type === "text_delta") onEvent({ type: "text", delta: event.delta });
        else if (event.type === "thinking_delta") onEvent({ type: "reasoning", delta: event.delta });
        else if (event.type === "toolcall_end") {
          onEvent({
            type: "toolCall",
            name: event.toolCall.name,
            callId: event.toolCall.id,
            arguments: event.toolCall.arguments,
          });
        }
      }
    } catch (error) {
      onEvent({ type: "error", message: (error as Error).message });
      return;
    }

    const assistant = await stream.result();
    messages.push(assistant);
    session.appendMessage(assistant);
    onEvent({ type: "message", message: assistant });

    if (assistant.stopReason === "aborted") {
      onEvent({ type: "cancelled" });
      return;
    }
    if (assistant.stopReason === "error") {
      onEvent({ type: "error", message: assistant.errorMessage ?? "provider error" });
      return;
    }

    const toolCalls = assistant.content.filter((block): block is ToolCall => block.type === "toolCall");
    if (toolCalls.length === 0) {
      onEvent({ type: "complete" });
      return;
    }

    // Steering is held until every result of this assistant turn has landed:
    // the provider rejects a user message between an assistant turn and its
    // tool results.
    const held: string[] = [];
    for (const call of toolCalls) {
      if (signal.aborted) {
        onEvent({ type: "cancelled" });
        return;
      }
      const steering = await pause();
      if (signal.aborted) {
        onEvent({ type: "cancelled" });
        return;
      }
      if (steering !== "") held.push(steering);
      onEvent({ type: "phase", phase: "runningTool", detail: call.name });

      const tool = run.toolNames.find((name) => name === call.name);
      let result: ToolResult;
      if (tool === undefined) {
        result = { text: `unknown tool: ${call.name}`, isError: true };
      } else {
        try {
          result = await executeTool(tool, call, {
            signal,
            supportsImages: acceptsImages(run.model),
            onOutput: (chunk) => onEvent({ type: "toolOutput", name: call.name, callId: call.id, chunk }),
          });
        } catch (error) {
          result = { text: (error as Error).message, isError: true };
        }
      }

      const toolMessage: ToolResultMessage<ToolDetails> = {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: result.text }, ...(result.images ?? [])],
        details: result.details,
        isError: result.isError,
        timestamp: Date.now(),
      };
      messages.push(toolMessage);
      session.appendMessage(toolMessage);
      onEvent({ type: "toolResult", name: call.name, callId: call.id, text: result.text, isError: result.isError });
    }
    steer(held);
  }
}
