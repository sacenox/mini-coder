import type {
	AgentReporter,
	StatusBarData,
	TurnResult,
} from "../agent/reporter.ts";
import type { TurnEvent } from "../llm-api/types.ts";
import {
	G,
	renderError,
	renderHook,
	renderInfo,
	renderStatusBar,
	renderTurn,
	restoreTerminal,
	Spinner,
	writeln,
} from "./output.ts";

export class CliReporter implements AgentReporter {
	private spinner = new Spinner();

	info(msg: string): void {
		this.spinner.stop();
		renderInfo(msg);
	}

	error(msg: string | Error, hint?: string): void {
		this.spinner.stop();
		if (typeof msg === "string") {
			renderError(msg, hint);
		} else {
			renderError(msg.message, hint);
		}
	}

	warn(msg: string): void {
		this.spinner.stop();
		writeln(`${G.warn} ${msg}`);
	}

	writeText(text: string): void {
		this.spinner.stop();
		writeln(text);
	}

	startSpinner(label?: string): void {
		this.spinner.start(label);
	}

	stopSpinner(): void {
		this.spinner.stop();
	}

	async renderTurn(
		events: AsyncIterable<TurnEvent>,
		opts?: { showReasoning?: boolean },
	): Promise<TurnResult> {
		return renderTurn(events, this.spinner, opts);
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
