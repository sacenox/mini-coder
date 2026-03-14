import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashLine } from "./hashline.ts";

export function createTestHelpers() {
	let dir = "";

	async function setup(prefix: string) {
		dir = await mkdtemp(join(tmpdir(), prefix));
	}

	async function teardown() {
		if (dir) {
			await rm(dir, { recursive: true, force: true });
			dir = "";
		}
	}

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

	function getDir(): string {
		return dir;
	}

	return { setup, teardown, write, read, anchor, getDir };
}

/**
 * Shared anchor-error tests for tools that accept an anchor parameter.
 * Call inside a describe block; the two tests are registered under it.
 */
export function registerAnchorErrorTests(opts: {
	missingFileCall: (anchor: string) => Promise<unknown>;
	badAnchorCall: (name: string, anchor: string) => Promise<unknown>;
	write: (name: string, content: string) => Promise<string>;
}): void {
	test("throws when file does not exist", async () => {
		await expect(opts.missingFileCall("1:00")).rejects.toThrow(
			"File not found",
		);
	});

	test("throws when anchor hash does not match", async () => {
		const name = await opts.write("f.txt", "a\nb\nc\n");
		await expect(opts.badAnchorCall(name, "2:ff")).rejects.toThrow(
			"Hash not found",
		);
	});
}
