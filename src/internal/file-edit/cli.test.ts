import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFileEditCli } from "./cli.ts";

let cwd = "";

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "mc-file-edit-cli-test-"));
});

afterEach(async () => {
	if (cwd) {
		await rm(cwd, { recursive: true, force: true });
		cwd = "";
	}
});

function createIo() {
	let stdout = "";
	let stderr = "";
	return {
		io: {
			stdout: (text: string) => {
				stdout += text;
			},
			stderr: (text: string) => {
				stderr += text;
			},
		},
		getStdout: () => stdout,
		getStderr: () => stderr,
	};
}

describe("runFileEditCli", () => {
	test("applies one edit from temp files and emits compact json", async () => {
		await writeFile(join(cwd, "f.txt"), "before\nOLD\nafter\n");
		await writeFile(join(cwd, "old.txt"), "OLD\n");
		await writeFile(join(cwd, "new.txt"), "NEW\n");
		const capture = createIo();

		const exitCode = await runFileEditCli(
			[
				"f.txt",
				"--cwd",
				cwd,
				"--old-file",
				join(cwd, "old.txt"),
				"--new-file",
				join(cwd, "new.txt"),
			],
			capture.io,
		);

		expect(exitCode).toBe(0);
		expect(capture.getStderr()).toBe("");
		expect(JSON.parse(capture.getStdout())).toEqual({
			ok: true,
			path: "f.txt",
			changed: true,
		});
		expect(await Bun.file(join(cwd, "f.txt")).text()).toBe(
			"before\nNEW\nafter\n",
		);
	});

	test("returns a structured invalid_args error", async () => {
		const capture = createIo();

		const exitCode = await runFileEditCli(
			["f.txt", "--old", "a", "--old-file", "old.txt"],
			capture.io,
		);

		expect(exitCode).toBe(1);
		expect(JSON.parse(capture.getStdout())).toEqual({
			ok: false,
			code: "invalid_args",
			message: "Provide exactly one of --old or --old-file.",
		});
	});
});
