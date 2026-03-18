import { describe, expect, test } from "bun:test";
import {
	parseSubagentOutput,
	resolveMcCommand,
	tailTextFromChunks,
} from "./subagent-runner.ts";

describe("tailTextFromChunks", () => {
	test("keeps only the byte tail without buffering everything", () => {
		const encode = (text: string) => new TextEncoder().encode(text);
		expect(tailTextFromChunks([encode("abc"), encode("def")], 4)).toBe("cdef");
		expect(tailTextFromChunks([encode("hello"), encode(" world")], 64)).toBe(
			"hello world",
		);
		expect(tailTextFromChunks([encode("hello")], 0)).toBe("");
	});

	test("respects utf-8 boundaries across chunk rotations", () => {
		const encoder = new TextEncoder();
		const emoji = encoder.encode("🙂");
		const prefix = encoder.encode("xx");
		const suffix = encoder.encode("yy");
		expect(tailTextFromChunks([prefix, emoji, suffix], emoji.length + 2)).toBe(
			"🙂yy",
		);
	});
});

describe("resolveMcCommand", () => {
	test("uses Bun.main for TypeScript entrypoints", () => {
		expect(
			resolveMcCommand("/usr/bin/bun", "/repo/src/index.ts", undefined),
		).toEqual(["/usr/bin/bun", "/repo/src/index.ts"]);
	});

	test("uses Bun.main for installed JavaScript entrypoints", () => {
		expect(
			resolveMcCommand("/usr/bin/bun", "/repo/dist/mc.js", undefined),
		).toEqual(["/usr/bin/bun", "/repo/dist/mc.js"]);
	});

	test("falls back to argv[1] when Bun.main is eval", () => {
		expect(
			resolveMcCommand("/usr/bin/bun", "/repo/[eval]", "/repo/src/index.ts"),
		).toEqual(["/usr/bin/bun", "/repo/src/index.ts"]);
	});

	test("returns bare execPath when no script entrypoint exists", () => {
		expect(resolveMcCommand("/repo/mc", undefined, "--help")).toEqual([
			"/repo/mc",
		]);
	});
});

describe("parseSubagentOutput", () => {
	test("returns error string for empty output", () => {
		const result = parseSubagentOutput("", 0);
		expect(typeof result).toBe("string");
		expect(result).toContain("no output");
	});

	test("returns error string for non-JSON output", () => {
		const result = parseSubagentOutput("not json", 0);
		expect(typeof result).toBe("string");
		expect(result).toContain("non-JSON");
	});

	test("returns error string when parsed JSON has error field", () => {
		const result = parseSubagentOutput(
			JSON.stringify({
				error: "something broke",
				result: "",
				inputTokens: 0,
				outputTokens: 0,
			}),
			0,
		);
		expect(typeof result).toBe("string");
		expect(result).toContain("something broke");
	});

	test("returns error string for non-zero exit code", () => {
		const result = parseSubagentOutput(
			JSON.stringify({ result: "ok", inputTokens: 10, outputTokens: 5 }),
			1,
		);
		expect(typeof result).toBe("string");
		expect(result).toContain("exit");
	});

	test("returns parsed summary on success", () => {
		const result = parseSubagentOutput(
			JSON.stringify({ result: "done", inputTokens: 100, outputTokens: 50 }),
			0,
		);
		expect(typeof result).toBe("object");
		expect(result).toEqual({
			result: "done",
			inputTokens: 100,
			outputTokens: 50,
		});
	});
});
