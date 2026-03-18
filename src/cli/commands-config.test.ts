import { describe, expect, test } from "bun:test";
import {
	handleContextCommand,
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
		pruningMode: "balanced",
		setPruningMode: () => {},
		toolResultPayloadCapBytes: 0,
		setToolResultPayloadCapBytes: () => {},
		undoLastTurn: async () => false,
		startNewSession: () => {},
		connectMcpServer: async () => {},
		activeAgent: null,
		setActiveAgent: () => {},
		startSpinner: () => {},
		stopSpinner: () => {},
		cwd: process.cwd(),
		...overrides,
	};
}

describe("commands-config", () => {
	test("/context cap accepts kilobytes", () => {
		let captured = 0;
		const ctx = createContext({
			setToolResultPayloadCapBytes: (bytes) => {
				captured = bytes;
			},
		});
		handleContextCommand(ctx, "cap 12kb");
		expect(captured).toBe(12 * 1024);
	});

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
