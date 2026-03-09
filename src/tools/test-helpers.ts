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
