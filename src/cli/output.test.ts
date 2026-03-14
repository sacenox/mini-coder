import { afterEach, describe, expect, test } from "bun:test";
import { renderUserMessage } from "./output.ts";
import { terminal } from "./terminal-io.ts";

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
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("renderUserMessage", () => {
	test("renders a compact single-line prompt entry", () => {
		captureStdout();

		renderUserMessage("ship it");

		expect(stripAnsi(stdout)).toBe("› ship it\n");
	});

	test("preserves multiline prompts as an indented history block", () => {
		captureStdout();

		renderUserMessage("plan\nstep 1\n\nstep 2");

		expect(stripAnsi(stdout)).toBe("› plan\n  step 1\n  \n  step 2\n");
	});
});
