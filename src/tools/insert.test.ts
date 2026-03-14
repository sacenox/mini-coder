import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { insertTool } from "./insert.ts";
import { createTestHelpers } from "./test-helpers.ts";
import { stripWriteResultMeta } from "./write-result.ts";

const { setup, teardown, write, read, anchor, getDir } = createTestHelpers();
// P3: diff is deferred; strip meta before asserting on public fields.
const execute = async (...args: Parameters<typeof insertTool.execute>) =>
	stripWriteResultMeta(await insertTool.execute(...args));

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
	await setup("mc-insert-test-");
});

afterEach(async () => {
	await teardown();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("insertTool", () => {
	test("inserts a single line after the anchor", async () => {
		const name = await write("f.txt", "a\nb\nc\n");
		const result = await execute({
			path: name,
			cwd: getDir(),
			anchor: anchor(1, "a"),
			position: "after",
			content: "X",
		});

		expect(await read(name)).toBe("a\nX\nb\nc\n");
		expect(result.diff).toContain("+X");
		// anchor line itself must not appear as changed
		expect(result.diff).not.toContain("-a");
	});

	test("inserts a single line before the anchor", async () => {
		const name = await write("f.txt", "a\nb\nc\n");
		const result = await execute({
			path: name,
			cwd: getDir(),
			anchor: anchor(2, "b"),
			position: "before",
			content: "X",
		});

		expect(await read(name)).toBe("a\nX\nb\nc\n");
		expect(result.diff).toContain("+X");
		expect(result.diff).not.toContain("-b");
	});

	test("inserts multiple lines", async () => {
		const name = await write("f.txt", "a\nb\n");
		await execute({
			path: name,
			cwd: getDir(),
			anchor: anchor(1, "a"),
			position: "after",
			content: "X\nY\nZ",
		});

		expect(await read(name)).toBe("a\nX\nY\nZ\nb\n");
	});

	test("inserts before the first line", async () => {
		const name = await write("f.txt", "a\nb\n");
		await execute({
			path: name,
			cwd: getDir(),
			anchor: anchor(1, "a"),
			position: "before",
			content: "FIRST",
		});

		expect(await read(name)).toBe("FIRST\na\nb\n");
	});

	test("inserts after the last line", async () => {
		const name = await write("f.txt", "a\nb\n");
		await execute({
			path: name,
			cwd: getDir(),
			anchor: anchor(2, "b"),
			position: "after",
			content: "LAST",
		});

		expect(await read(name)).toBe("a\nb\nLAST\n");
	});

	test("returns path relative to cwd", async () => {
		const name = await write("f.txt", "a\nb\n");
		const result = await execute({
			path: name,
			cwd: getDir(),
			anchor: anchor(1, "a"),
			position: "after",
			content: "X",
		});

		expect(result.path).toBe(name);
	});

	test("diff contains only added lines, no removals", async () => {
		const name = await write("f.txt", "a\nb\nc\n");
		const result = await execute({
			path: name,
			cwd: getDir(),
			anchor: anchor(2, "b"),
			position: "after",
			content: "NEW",
		});

		expect(result.diff).toContain("+NEW");
		expect(result.diff).not.toMatch(/^-[^-]/m);
	});

	test("throws when file does not exist", async () => {
		await expect(
			execute({
				path: "missing.txt",
				cwd: getDir(),
				anchor: "1:00",
				position: "after",
				content: "X",
			}),
		).rejects.toThrow("File not found");
	});

	test("throws when anchor hash does not match", async () => {
		const name = await write("f.txt", "a\nb\nc\n");
		await expect(
			execute({
				path: name,
				cwd: getDir(),
				anchor: "2:ff", // wrong hash for "b"
				position: "after",
				content: "X",
			}),
		).rejects.toThrow("Hash not found");
	});

	test("throws on malformed anchor format", async () => {
		const name = await write("f.txt", "a\n");
		await expect(
			execute({
				path: name,
				cwd: getDir(),
				anchor: "not-an-anchor",
				position: "before",
				content: "X",
			}),
		).rejects.toThrow("Invalid anchor");
	});
	test("accepts anchor with trailing pipe separator", async () => {
		const name = await write("f.txt", "a\nb\nc\n");
		await execute({
			path: name,
			cwd: getDir(),
			anchor: `${anchor(2, "b")}|`,
			position: "after",
			content: "X",
		});

		expect(await read(name)).toBe("a\nb\nX\nc\n");
	});
});
