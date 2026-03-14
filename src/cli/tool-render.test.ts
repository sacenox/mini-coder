import { afterEach, describe, expect, test } from "bun:test";
import { terminal } from "./terminal-io.ts";
import { buildToolCallLine, renderToolResult } from "./tool-render.ts";

let stdout = "";
const originalStdoutWrite = terminal.stdoutWrite.bind(terminal);

afterEach(() => {
	stdout = "";
	terminal.stdoutWrite = originalStdoutWrite;
});

function captureStdout(): void {
	terminal.stdoutWrite = (text: string) => {
		stdout += text;
	};
}

function stripAnsi(text: string): string {
	const esc = String.fromCharCode(0x1b);
	return text.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "");
}

describe("buildToolCallLine", () => {
	test("formats shell calls with truncated command previews", () => {
		const line = buildToolCallLine("shell", {
			command: "echo x".repeat(30),
		});
		expect(line).toContain("$");
		expect(line).toContain("echo x");
		expect(line).toContain("…");
	});

	test("formats read calls with line and count range", () => {
		const line = buildToolCallLine("read", {
			path: "src/index.ts",
			line: 12,
			count: 25,
		});
		expect(line).toContain("read");
		expect(line).toContain("src/index.ts");
		expect(line).toContain(":12+25");
	});

	test("formats subagent calls with agent label", () => {
		const line = buildToolCallLine("subagent", {
			agentName: "reviewer",
			prompt: "Review this diff",
		});
		expect(line).toContain("[@reviewer]");
		expect(line).toContain("Review this diff");
	});

	test("formats empty shell start events as a generic shell label", () => {
		const line = buildToolCallLine("shell", {});
		expect(line).toContain("$");
		expect(line).toContain("shell");
	});

	test("formats read start events without path cleanly", () => {
		const line = buildToolCallLine("read", {});
		expect(line).toContain("read");
		expect(line).not.toContain("undefined");
	});
});

describe("renderToolResult", () => {
	test("does not duplicate streamed shell output previews", () => {
		captureStdout();

		renderToolResult(
			"shell",
			{
				stdout: "",
				stderr: "boom",
				exitCode: 1,
				success: false,
				timedOut: false,
				streamedOutput: true,
			},
			false,
		);

		const plain = stripAnsi(stdout);
		expect(plain).toContain("error exit 1 · stdout 0L · stderr 1L · streamed");
		expect(plain).not.toContain("stderr (1 lines)");
		expect(plain).not.toContain("│ boom");
	});
});
