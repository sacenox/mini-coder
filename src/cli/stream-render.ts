import * as c from "yoctocolors";
import { buildAbortMessages, isAbortError } from "../agent/agent-helpers.ts";
import type { CoreMessage } from "../llm-api/turn.ts";
import type { TurnEvent } from "../llm-api/types.ts";
import { G, RenderedError, renderError, writeln } from "./output.ts";
import {
	normalizeReasoningDelta,
	normalizeReasoningText,
} from "./reasoning.ts";
import type { Spinner } from "./spinner.ts";
import { StreamRenderContent } from "./stream-render-content.ts";
import { renderToolCall, renderToolResult } from "./tool-render.ts";

export async function renderTurn(
	events: AsyncIterable<TurnEvent>,
	spinner: Spinner,
	opts?: { showReasoning?: boolean },
): Promise<{
	inputTokens: number;
	outputTokens: number;
	contextTokens: number;
	newMessages: CoreMessage[];
	reasoningText: string;
}> {
	const showReasoning = opts?.showReasoning ?? true;
	const content = new StreamRenderContent(spinner);

	let inputTokens = 0;
	let outputTokens = 0;
	let contextTokens = 0;
	let newMessages: CoreMessage[] = [];
	const startedToolCalls = new Set<string>();

	for await (const event of events) {
		switch (event.type) {
			case "text-delta": {
				content.appendTextDelta(event.delta);
				break;
			}
			case "reasoning-delta": {
				const delta = normalizeReasoningDelta(event.delta);
				content.appendReasoningDelta(delta, showReasoning);
				break;
			}

			case "tool-call-start": {
				if (startedToolCalls.has(event.toolCallId)) {
					break;
				}
				startedToolCalls.add(event.toolCallId);
				content.flushOpenContent();
				spinner.stop();
				renderToolCall(event.toolName, event.args);

				spinner.start(event.toolName);
				break;
			}

			case "tool-result": {
				startedToolCalls.delete(event.toolCallId);
				spinner.stop();
				renderToolResult(event.toolName, event.result, event.isError);

				spinner.start("thinking");
				break;
			}

			case "context-pruned": {
				content.flushOpenContent();
				spinner.stop();
				const removedKb = (event.removedBytes / 1024).toFixed(1);
				writeln(
					`${G.info} ${c.dim("context pruned")}  ${c.dim(event.mode)}  ${c.dim(`–${event.removedMessageCount} messages`)}  ${c.dim(`–${removedKb} KB`)}`,
				);
				break;
			}

			case "turn-complete": {
				const hadContent = content.hasOpenContent();
				content.flushOpenContent();
				spinner.stop();
				if (!hadContent) writeln();
				inputTokens = event.inputTokens;
				outputTokens = event.outputTokens;
				contextTokens = event.contextTokens;
				newMessages = event.messages;
				break;
			}

			case "turn-error": {
				content.flushOpenContent();
				spinner.stop();
				if (isAbortError(event.error)) {
					newMessages = buildAbortMessages(
						event.partialMessages,
						content.getText(),
					);
				} else {
					renderError(event.error, "turn");
					throw new RenderedError(event.error);
				}
				break;
			}
		}
	}

	return {
		inputTokens,
		outputTokens,
		contextTokens,
		newMessages,
		reasoningText: normalizeReasoningText(content.getReasoning()),
	};
}
