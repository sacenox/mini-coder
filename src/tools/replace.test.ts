import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashLine } from "./hashline.ts";
import { replaceTool } from "./replace.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dir: string;

/** Write a file into the temp dir and return its basename. */
async function write(name: string, content: string): Promise<string> {
	await writeFile(join(dir, name), content);
	return name;
}

/** Read a file from the temp dir. */
async function read(name: string): Promise<string> {
	return Bun.file(join(dir, name)).text();
}

/** Build an anchor string "line:hash" for the given line content. */
function anchor(lineNum: number, lineContent: string): string {
	return `${lineNum}:${hashLine(lineContent)}`;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "mc-replace-test-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("replaceTool", () => {
	test("replaces a single line", async () => {
		const name = await write("f.txt", "a\nb\nc\n");
		const result = await replaceTool.execute({
			path: name,
			cwd: dir,
			startAnchor: anchor(2, "b"),
			newContent: "B",
		});

		expect(await read(name)).toBe("a\nB\nc\n");
		expect(result.diff).toContain("-b");
		expect(result.diff).toContain("+B");
	});

	test("replaces a range of lines", async () => {
		const name = await write("f.txt", "a\nb\nc\nd\ne\n");
		const result = await replaceTool.execute({
			path: name,
			cwd: dir,
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
		const result = await replaceTool.execute({
			path: name,
			cwd: dir,
			startAnchor: anchor(2, "b"),
		});

		expect(await read(name)).toBe("a\nc\n");
		expect(result.diff).toContain("-b");
		expect(result.diff).not.toMatch(/^\+[^+]/m);
	});

	test("deletes a range when newContent is empty string", async () => {
		const name = await write("f.txt", "a\nb\nc\nd\n");
		await replaceTool.execute({
			path: name,
			cwd: dir,
			startAnchor: anchor(2, "b"),
			endAnchor: anchor(3, "c"),
			newContent: "",
		});

		expect(await read(name)).toBe("a\nd\n");
	});

	test("returns (no changes) diff when replacement is identical to original", async () => {
		const name = await write("f.txt", "a\nb\nc\n");
		const result = await replaceTool.execute({
			path: name,
			cwd: dir,
			startAnchor: anchor(2, "b"),
			newContent: "b",
		});

		expect(result.diff).toBe("(no changes)");
	});

	test("returns path relative to cwd", async () => {
		const name = await write("f.txt", "a\nb\n");
		const result = await replaceTool.execute({
			path: name,
			cwd: dir,
			startAnchor: anchor(1, "a"),
			newContent: "A",
		});

		expect(result.path).toBe(name);
	});

	test("throws when file does not exist", async () => {
		await expect(
			replaceTool.execute({
				path: "missing.txt",
				cwd: dir,
				startAnchor: "1:00",
			}),
		).rejects.toThrow("File not found");
	});

	test("throws when anchor hash does not match", async () => {
		const name = await write("f.txt", "a\nb\nc\n");
		await expect(
			replaceTool.execute({
				path: name,
				cwd: dir,
				startAnchor: "2:ff", // wrong hash for "b"
			}),
		).rejects.toThrow("Hash not found");
	});

	test("throws when endAnchor is before startAnchor", async () => {
		const name = await write("f.txt", "a\nb\nc\n");
		await expect(
			replaceTool.execute({
				path: name,
				cwd: dir,
				startAnchor: anchor(3, "c"),
				endAnchor: anchor(1, "a"),
			}),
		).rejects.toThrow();
	});

	test("throws on malformed anchor format", async () => {
		const name = await write("f.txt", "a\n");
		await expect(
			replaceTool.execute({
				path: name,
				cwd: dir,
				startAnchor: "not-an-anchor",
			}),
		).rejects.toThrow("Invalid startAnchor");
	});
});
