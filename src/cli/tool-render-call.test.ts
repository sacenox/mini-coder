import { describe, expect, test } from "bun:test";
import { buildToolCallLine } from "./tool-render-call.ts";

describe("buildToolCallLine", () => {
	test("formats shell calls with truncated command previews", () => {
		const line = buildToolCallLine("shell", {
			command: "echo x".repeat(30),
		});
		expect(line).toContain("$");
		expect(line).toContain("echo x");
		expect(line).toContain("…");
	});

	test("formats read calls with line and count range", () => {
		const line = buildToolCallLine("read", {
			path: "src/index.ts",
			line: 12,
			count: 25,
		});
		expect(line).toContain("read");
		expect(line).toContain("src/index.ts");
		expect(line).toContain(":12+25");
	});

	test("formats subagent calls with agent label", () => {
		const line = buildToolCallLine("subagent", {
			agentName: "reviewer",
			prompt: "Review this diff",
		});
		expect(line).toContain("[@reviewer]");
		expect(line).toContain("Review this diff");
	});
});
