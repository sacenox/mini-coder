import { describe, expect, test } from "bun:test";
import {
	handleReasoningCommand,
	handleVerboseCommand,
} from "./commands-config.ts";
import type { CommandContext } from "./types.ts";

function createContext(overrides?: Partial<CommandContext>): CommandContext {
	return {
		currentModel: "zen/claude-sonnet-4-6",
		setModel: () => {},
		thinkingEffort: null,
		setThinkingEffort: () => {},
		showReasoning: true,
		setShowReasoning: () => {},
		verboseOutput: false,
		setVerboseOutput: () => {},

		undoLastTurn: async () => false,
		startNewSession: () => {},
		switchSession: () => false,
		connectMcpServer: async () => {},
		startSpinner: () => {},
		stopSpinner: () => {},
		cwd: process.cwd(),
		...overrides,
	};
}

describe("commands-config", () => {
	test("/reasoning toggles when no arg is provided", () => {
		let reasoningVisible = true;
		const ctx = createContext({
			showReasoning: reasoningVisible,
			setShowReasoning: (value) => {
				reasoningVisible = value;
			},
		});
		handleReasoningCommand(ctx, "");
		expect(reasoningVisible).toBe(false);
	});

	test("/verbose toggles when no arg is provided", () => {
		let verboseOutput = false;
		const ctx = createContext({
			verboseOutput,
			setVerboseOutput: (value) => {
				verboseOutput = value;
			},
		});
		handleVerboseCommand(ctx, "");
		expect(verboseOutput).toBe(true);
	});
});
