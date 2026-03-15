import { describe, expect, test } from "bun:test";
import {
	buildFileEditShellPrelude,
	resolveFileEditCommand,
} from "./command.ts";

describe("resolveFileEditCommand", () => {
	test("resolves the source helper beside src/index.ts", () => {
		expect(
			resolveFileEditCommand(
				"/usr/bin/bun",
				"/repo/src/index.ts",
				undefined,
				import.meta.url,
			),
		).toEqual(["/usr/bin/bun", "/repo/src/mc-edit.ts"]);
	});

	test("resolves the built helper beside dist/mc.js", () => {
		expect(
			resolveFileEditCommand(
				"/usr/bin/bun",
				"/repo/dist/mc.js",
				undefined,
				import.meta.url,
			),
		).toEqual(["/usr/bin/bun", "/repo/dist/mc-edit.js"]);
	});

	test("falls back to mc-edit when no script entrypoint is available", () => {
		expect(
			resolveFileEditCommand(
				"/usr/bin/bun",
				"/repo/[eval]",
				undefined,
				"file:///nonexistent/command.ts",
			),
		).toEqual(["mc-edit"]);
	});
});

describe("buildFileEditShellPrelude", () => {
	test("defines an mc-edit shell function that preserves arguments", () => {
		expect(buildFileEditShellPrelude(["bun", "/repo/src/mc-edit.ts"])).toBe(
			"mc-edit() { 'bun' '/repo/src/mc-edit.ts' \"$@\"; }",
		);
	});
});
