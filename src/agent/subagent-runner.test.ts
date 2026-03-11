import { describe, expect, test } from "bun:test";
import { resolveMcCommand } from "./subagent-runner.ts";

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
