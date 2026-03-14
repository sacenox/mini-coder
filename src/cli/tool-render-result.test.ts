import { afterEach, describe, expect, test } from "bun:test";
import { terminal } from "./terminal-io.ts";
import { renderToolResult } from "./tool-render-result.ts";

const originalStdoutWrite = terminal.stdoutWrite.bind(terminal);
let stdout = "";

function stripAnsi(input: string): string {
	const esc = String.fromCharCode(0x1b);
	return input.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "");
}

afterEach(() => {
	stdout = "";
	terminal.stdoutWrite = originalStdoutWrite;
});

describe("renderToolResult", () => {
	test("renders compact shell summary with stdout and stderr previews", () => {
		terminal.stdoutWrite = (chunk: string) => {
			stdout += chunk;
		};

		renderToolResult(
			"shell",
			{
				stdout: "line 1\nline 2",
				stderr: "err 1",
				exitCode: 0,
				success: true,
				timedOut: false,
			},
			false,
		);

		const plain = stripAnsi(stdout);
		expect(plain).toContain("exit 0 · stdout 2L · stderr 1L");
		expect(plain).not.toContain("stdout (2 lines)");
		expect(plain).not.toContain("stderr (1 lines)");
	});

	test("keeps successful multi-line shell output compact", () => {
		terminal.stdoutWrite = (chunk: string) => {
			stdout += chunk;
		};

		renderToolResult(
			"shell",
			{
				stdout: "a\nb\nc\nd\ne",
				stderr: "",
				exitCode: 0,
				success: true,
				timedOut: false,
			},
			false,
		);

		const plain = stripAnsi(stdout);
		expect(plain).toContain("exit 0 · stdout 5L · stderr 0L");
		expect(plain).not.toContain("stdout omitted");
		expect(plain).not.toContain("stdout (5 lines)");
	});

	test("renders compact one-line stdout for successful shell calls", () => {
		terminal.stdoutWrite = (chunk: string) => {
			stdout += chunk;
		};

		renderToolResult(
			"shell",
			{
				stdout: "/home/xonecas/src/mini-coder\n",
				stderr: "",
				exitCode: 0,
				success: true,
				timedOut: false,
			},
			false,
		);

		const plain = stripAnsi(stdout);
		expect(plain).toContain("exit 0 · stdout 1L · stderr 0L");
		expect(plain).toContain("out: /home/xonecas/src/mini-coder");
		expect(plain).not.toContain("stdout (1 lines)");
	});

	test("renders file edit diff for create", () => {
		terminal.stdoutWrite = (chunk: string) => {
			stdout += chunk;
		};

		renderToolResult(
			"create",
			{
				path: "src/new.ts",
				created: true,
				diff: "@@ -0,0 +1 @@\n+console.log('ok')",
			},
			false,
		);

		const plain = stripAnsi(stdout);
		expect(plain).toContain("created src/new.ts");
		expect(plain).toContain("@@ -0,0 +1 @@");
		expect(plain).toContain("+console.log('ok')");
	});

	test("truncates large file edit diffs to keep output compact", () => {
		terminal.stdoutWrite = (chunk: string) => {
			stdout += chunk;
		};

		const diffLines = [
			"@@ -0,0 +30 @@",
			...Array.from({ length: 30 }, (_, i) => `+line ${i + 1}`),
		];
		renderToolResult(
			"create",
			{
				path: "src/huge.ts",
				created: true,
				diff: diffLines.join("\n"),
			},
			false,
		);

		const plain = stripAnsi(stdout);
		expect(plain).toContain("created src/huge.ts");
		expect(plain).toContain("+line 1");
		expect(plain).toContain("+line 23");
		expect(plain).toContain("… +7 more diff lines");
		expect(plain).not.toContain("+line 30");
	});

	test("renders one-line error when tool result fails", () => {
		terminal.stdoutWrite = (chunk: string) => {
			stdout += chunk;
		};

		renderToolResult("read", "boom\ndetails", true);
		const plain = stripAnsi(stdout);
		expect(plain).toContain("✖ boom");
		expect(plain).not.toContain("details");
	});
});
