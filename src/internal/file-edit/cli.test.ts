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

function stripAnsi(text: string): string {
	const esc = String.fromCharCode(0x1b);
	return text.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "");
}

describe("runFileEditCli", () => {
	test("renders a unified diff and metadata for a changed file", async () => {
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
		expect(stripAnsi(capture.getStdout())).toBe(
			[
				"--- f.txt",
				"+++ f.txt",
				"@@ -1,3 +1,3 @@",
				" before",
				"-OLD",
				"+NEW",
				" after",
				"",
				"ok: true",
				"path: f.txt",
				"changed: true",
				"",
			].join("\n"),
		);
		expect(await Bun.file(join(cwd, "f.txt")).text()).toBe(
			"before\nNEW\nafter\n",
		);
	});

	test("renders a no-op result without a fake diff", async () => {
		await writeFile(join(cwd, "f.txt"), "same\n");
		const capture = createIo();

		const exitCode = await runFileEditCli(
			["f.txt", "--cwd", cwd, "--old", "same\n", "--new", "same\n"],
			capture.io,
		);

		expect(exitCode).toBe(0);
		expect(capture.getStderr()).toBe("");
		expect(stripAnsi(capture.getStdout())).toBe(
			[
				"(no changes)",
				"",
				"ok: true",
				"path: f.txt",
				"changed: false",
				"",
			].join("\n"),
		);
	});

	test("renders invalid argument errors to stderr", async () => {
		const capture = createIo();

		const exitCode = await runFileEditCli(
			["f.txt", "--old", "a", "--old-file", "old.txt"],
			capture.io,
		);

		expect(exitCode).toBe(1);
		expect(capture.getStdout()).toBe("");
		expect(stripAnsi(capture.getStderr())).toBe(
			[
				"ok: false",
				"code: invalid_args",
				"message: Provide exactly one of --old or --old-file.",
				"",
			].join("\n"),
		);
	});
});
