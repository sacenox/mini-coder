import { describe, expect, mock, test } from "bun:test";
import { buildStreamTextRequest } from "./turn-request.ts";
import type { CoreMessage } from "./turn.ts";

describe("buildStreamTextRequest", () => {
	test("overrides the AI SDK default onError logger", () => {
		const request = buildStreamTextRequest({
			model: {} as Parameters<typeof buildStreamTextRequest>[0]["model"],
			prepared: {
				messages: [{ role: "user", content: "hi" }] as CoreMessage[],
				systemPrompt: undefined,
				pruned: false,
				prePruneMessageCount: 1,
				postPruneMessageCount: 1,
				prePruneTotalBytes: 2,
				postPruneTotalBytes: 2,
			},
			toolSet: {},
			onStepFinish: () => {},
			signal: undefined,
			providerOptions: {},
			maxSteps: 50,
		});

		const originalConsoleError = console.error;
		const consoleError = mock(() => {});
		console.error = consoleError;
		try {
			request.onError?.({ error: new Error("boom") });
		} finally {
			console.error = originalConsoleError;
		}

		expect(consoleError).not.toHaveBeenCalled();
	});
});
