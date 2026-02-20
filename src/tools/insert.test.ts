import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashLine } from "./hashline.ts";
import { insertTool } from "./insert.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dir: string;

async function write(name: string, content: string): Promise<string> {
	await writeFile(join(dir, name), content);
	return name;
}

async function read(name: string): Promise<string> {
	return Bun.file(join(dir, name)).text();
}

function anchor(lineNum: number, lineContent: string): string {
	return `${lineNum}:${hashLine(lineContent)}`;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "mc-insert-test-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("insertTool", () => {
	test("inserts a single line after the anchor", async () => {
		const name = await write("f.txt", "a\nb\nc\n");
		const result = await insertTool.execute({
			path: name,
			cwd: dir,
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
		const result = await insertTool.execute({
			path: name,
			cwd: dir,
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
		await insertTool.execute({
			path: name,
			cwd: dir,
			anchor: anchor(1, "a"),
			position: "after",
			content: "X\nY\nZ",
		});

		expect(await read(name)).toBe("a\nX\nY\nZ\nb\n");
	});

	test("inserts before the first line", async () => {
		const name = await write("f.txt", "a\nb\n");
		await insertTool.execute({
			path: name,
			cwd: dir,
			anchor: anchor(1, "a"),
			position: "before",
			content: "FIRST",
		});

		expect(await read(name)).toBe("FIRST\na\nb\n");
	});

	test("inserts after the last line", async () => {
		const name = await write("f.txt", "a\nb\n");
		await insertTool.execute({
			path: name,
			cwd: dir,
			anchor: anchor(2, "b"),
			position: "after",
			content: "LAST",
		});

		expect(await read(name)).toBe("a\nb\nLAST\n");
	});

	test("returns path relative to cwd", async () => {
		const name = await write("f.txt", "a\nb\n");
		const result = await insertTool.execute({
			path: name,
			cwd: dir,
			anchor: anchor(1, "a"),
			position: "after",
			content: "X",
		});

		expect(result.path).toBe(name);
	});

	test("diff contains only added lines, no removals", async () => {
		const name = await write("f.txt", "a\nb\nc\n");
		const result = await insertTool.execute({
			path: name,
			cwd: dir,
			anchor: anchor(2, "b"),
			position: "after",
			content: "NEW",
		});

		expect(result.diff).toContain("+NEW");
		expect(result.diff).not.toMatch(/^-[^-]/m);
	});

	test("throws when file does not exist", async () => {
		await expect(
			insertTool.execute({
				path: "missing.txt",
				cwd: dir,
				anchor: "1:00",
				position: "after",
				content: "X",
			}),
		).rejects.toThrow("File not found");
	});

	test("throws when anchor hash does not match", async () => {
		const name = await write("f.txt", "a\nb\nc\n");
		await expect(
			insertTool.execute({
				path: name,
				cwd: dir,
				anchor: "2:ff", // wrong hash for "b"
				position: "after",
				content: "X",
			}),
		).rejects.toThrow("Hash not found");
	});

	test("throws on malformed anchor format", async () => {
		const name = await write("f.txt", "a\n");
		await expect(
			insertTool.execute({
				path: name,
				cwd: dir,
				anchor: "not-an-anchor",
				position: "before",
				content: "X",
			}),
		).rejects.toThrow("Invalid anchor");
	});
});
