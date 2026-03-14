import { describe, expect, test } from "bun:test";
import { resolveMcCommand, tailTextFromChunks } from "./subagent-runner.ts";

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
