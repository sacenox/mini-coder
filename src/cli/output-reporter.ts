import * as c from "yoctocolors";
import type {
	AgentReporter,
	StatusBarData,
	SubagentEventData,
	TurnResult,
} from "../agent/reporter.ts";
import type { CoreMessage } from "../llm-api/turn.ts";
import type { TurnEvent } from "../llm-api/types.ts";
import {
	PREFIX,
	Spinner,
	renderError,
	renderHook,
	renderInfo,
	renderStatusBar,
	renderSubagentEvent,
	renderTurn,
	restoreTerminal,
	writeln,
} from "./output.ts";

export class CliReporter implements AgentReporter {
	private spinner = new Spinner();

	info(msg: string): void {
		renderInfo(msg);
	}

	error(msg: string | Error, hint?: string): void {
		if (typeof msg === "string") {
			renderError(msg, hint);
		} else {
			renderError(msg.message, hint);
		}
	}

	warn(msg: string): void {
		writeln(`! ${c.yellow(msg)}`);
	}

	writeText(text: string): void {
		writeln(text);
	}

	startSpinner(label?: string): void {
		this.spinner.start(label);
	}

	stopSpinner(): void {
		this.spinner.stop();
	}

	async renderTurn(events: AsyncIterable<TurnEvent>): Promise<TurnResult> {
		return renderTurn(events, this.spinner);
	}

	renderSubagentEvent(event: TurnEvent, data: SubagentEventData): void {
		renderSubagentEvent(event, data);
	}

	renderStatusBar(data: StatusBarData): void {
		renderStatusBar(data);
	}

	renderHook(toolName: string, scriptPath: string, success: boolean): void {
		renderHook(toolName, scriptPath, success);
	}

	restoreTerminal(): void {
		restoreTerminal();
	}
}
