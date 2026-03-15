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

	test("formats readSkill calls with the requested skill name", () => {
		const line = buildToolCallLine("readSkill", { name: "deploy" });
		expect(line).toContain("read skill");
		expect(line).toContain("deploy");
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
		expect(plain).toContain("error exit 1 · stderr 1L");
		expect(plain).not.toContain("stderr (1 lines)");
		expect(plain).not.toContain("│ boom");
	});

	test("does not repeat successful single-line stdout when it was streamed live", () => {
		captureStdout();

		renderToolResult(
			"shell",
			{
				stdout: "done",
				stderr: "",
				exitCode: 0,
				success: true,
				timedOut: false,
				streamedOutput: true,
			},
			false,
		);

		const plain = stripAnsi(stdout);
		expect(plain).toContain("done exit 0");
		expect(plain).not.toContain("out: done");
	});

	test("shows stdout previews for non-streamed successful multi-line commands", () => {
		captureStdout();

		renderToolResult(
			"shell",
			{
				stdout: "hello\nworld",
				stderr: "",
				exitCode: 0,
				success: true,
				timedOut: false,
				streamedOutput: false,
			},
			false,
		);

		const plain = stripAnsi(stdout);
		expect(plain).toContain("done exit 0 · stdout 2L");
		expect(plain).toContain("stdout (2 lines)");
		expect(plain).toContain("│ hello");
		expect(plain).toContain("│ world");
	});

	test("renders compact listSkills previews", () => {
		captureStdout();

		renderToolResult(
			"listSkills",
			{
				skills: [
					{ name: "deploy", description: "Deploy safely", source: "local" },
					{ name: "release", description: "Ship releases", source: "global" },
				],
			},
			false,
		);

		const plain = stripAnsi(stdout);
		expect(plain).toContain("deploy  ·  local  ·  Deploy safely");
		expect(plain).toContain("release  ·  global  ·  Ship releases");
	});
});
