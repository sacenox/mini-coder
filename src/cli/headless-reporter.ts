import { buildAbortMessages, isAbortError } from "../agent/agent-helpers.ts";
import type {
	AgentReporter,
	StatusBarData,
	TurnResult,
} from "../agent/reporter.ts";
import type { CoreMessage } from "../llm-api/turn.ts";
import type { TurnEvent } from "../llm-api/types.ts";

/**
 * A no-op reporter for headless (subprocess) mode.
 * Consumes all turn events silently and tracks token counts.
 */
export class HeadlessReporter implements AgentReporter {
	info(_msg: string): void {}
	error(_msg: string | Error, _hint?: string): void {}
	warn(_msg: string): void {}
	writeText(_text: string): void {}
	startSpinner(_label?: string): void {}
	stopSpinner(): void {}

	async renderTurn(events: AsyncIterable<TurnEvent>): Promise<TurnResult> {
		let inputTokens = 0;
		let outputTokens = 0;
		let contextTokens = 0;
		let newMessages: CoreMessage[] = [];
		let accumulatedText = "";

		for await (const event of events) {
			switch (event.type) {
				case "text-delta":
					accumulatedText += event.delta;
					break;
				case "turn-complete":
					inputTokens = event.inputTokens;
					outputTokens = event.outputTokens;
					contextTokens = event.contextTokens;
					newMessages = event.messages;
					break;
				case "turn-error": {
					const isAbort = isAbortError(event.error);
					if (isAbort) {
						newMessages = buildAbortMessages(
							event.partialMessages,
							accumulatedText,
						);
					} else {
						throw event.error;
					}
					break;
				}
			}
		}

		return { inputTokens, outputTokens, contextTokens, newMessages };
	}

	renderStatusBar(_data: StatusBarData): void {}
	renderHook(_toolName: string, _scriptPath: string, _success: boolean): void {}
	restoreTerminal(): void {}
}
