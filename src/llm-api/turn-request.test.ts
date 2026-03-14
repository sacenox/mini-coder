import { describe, expect, test } from "bun:test";
import type { CoreMessage } from "./turn.ts";
import { buildStreamTextRequest } from "./turn-request.ts";

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

		expect(request.onError?.({ error: new Error("boom") })).toBeUndefined();
	});
});
