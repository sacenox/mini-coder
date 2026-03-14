import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { replaceTool } from "./replace.ts";
import { createTestHelpers, registerAnchorErrorTests } from "./test-helpers.ts";
import { stripWriteResultMeta } from "./write-result.ts";

const { setup, teardown, write, read, anchor, getDir } = createTestHelpers();
// diff is deferred; strip meta before asserting on public fields.
const execute = async (...args: Parameters<typeof replaceTool.execute>) =>
	stripWriteResultMeta(await replaceTool.execute(...args));

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
	await setup("mc-replace-test-");
});

afterEach(async () => {
	await teardown();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("replaceTool", () => {
	test("replaces a single line", async () => {
		const name = await write("f.txt", "a\nb\nc\n");
		const result = await execute({
			path: name,
			cwd: getDir(),
			startAnchor: anchor(2, "b"),
			newContent: "B",
		});

		expect(await read(name)).toBe("a\nB\nc\n");
		expect(result.diff).toContain("-b");
		expect(result.diff).toContain("+B");
	});

	test("replaces a range of lines", async () => {
		const name = await write("f.txt", "a\nb\nc\nd\ne\n");
		const result = await execute({
			path: name,
			cwd: getDir(),
			startAnchor: anchor(2, "b"),
			endAnchor: anchor(4, "d"),
			newContent: "X\nY",
		});

		expect(await read(name)).toBe("a\nX\nY\ne\n");
		expect(result.diff).toContain("-b");
		expect(result.diff).toContain("-c");
		expect(result.diff).toContain("-d");
		expect(result.diff).toContain("+X");
		expect(result.diff).toContain("+Y");
	});

	test("deletes a single line when newContent is omitted", async () => {
		const name = await write("f.txt", "a\nb\nc\n");
		const result = await execute({
			path: name,
			cwd: getDir(),
			startAnchor: anchor(2, "b"),
		});

		expect(await read(name)).toBe("a\nc\n");
		expect(result.diff).toContain("-b");
		expect(result.diff).not.toMatch(/^\+[^+]/m);
	});

	test("deletes a range when newContent is empty string", async () => {
		const name = await write("f.txt", "a\nb\nc\nd\n");
		await execute({
			path: name,
			cwd: getDir(),
			startAnchor: anchor(2, "b"),
			endAnchor: anchor(3, "c"),
			newContent: "",
		});

		expect(await read(name)).toBe("a\nd\n");
	});

	test("returns (no changes) diff when replacement is identical to original", async () => {
		const name = await write("f.txt", "a\nb\nc\n");
		const result = await execute({
			path: name,
			cwd: getDir(),
			startAnchor: anchor(2, "b"),
			newContent: "b",
		});

		expect(result.diff).toBe("(no changes)");
	});

	test("returns path relative to cwd", async () => {
		const name = await write("f.txt", "a\nb\n");
		const result = await execute({
			path: name,
			cwd: getDir(),
			startAnchor: anchor(1, "a"),
			newContent: "A",
		});

		expect(result.path).toBe(name);
	});

	registerAnchorErrorTests({
		missingFileCall: (a) =>
			execute({ path: "missing.txt", cwd: getDir(), startAnchor: a }),
		badAnchorCall: (name, a) =>
			execute({ path: name, cwd: getDir(), startAnchor: a }), // wrong hash for "b"
		write,
	});

	test("throws when endAnchor is before startAnchor", async () => {
		const name = await write("f.txt", "a\nb\nc\n");
		await expect(
			execute({
				path: name,
				cwd: getDir(),
				startAnchor: anchor(3, "c"),
				endAnchor: anchor(1, "a"),
			}),
		).rejects.toThrow();
	});

	test("throws on malformed anchor format", async () => {
		const name = await write("f.txt", "a\n");
		await expect(
			execute({
				path: name,
				cwd: getDir(),
				startAnchor: "not-an-anchor",
			}),
		).rejects.toThrow("Invalid startAnchor");
	});
	test("accepts anchors with trailing pipe separator", async () => {
		const name = await write("f.txt", "a\nb\nc\n");
		await execute({
			path: name,
			cwd: getDir(),
			startAnchor: `${anchor(2, "b")}|`,
			newContent: "B",
		});

		expect(await read(name)).toBe("a\nB\nc\n");
	});
});
