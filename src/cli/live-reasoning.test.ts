import { afterEach, describe, expect, test } from "bun:test";
import { LiveReasoningBlock } from "./live-reasoning.ts";
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
	const esc = String.fromCharCode(0x1b);
	return text.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "");
}

describe("LiveReasoningBlock", () => {
	test("streams partial reasoning immediately instead of waiting for finish", () => {
		captureStdout();
		const block = new LiveReasoningBlock();

		block.append("think");
		expect(stripAnsi(stdout)).toBe("· reasoning\n  think");

		block.append("ing");
		expect(stripAnsi(stdout)).toBe("· reasoning\n  thinking");

		block.finish();
		expect(stripAnsi(stdout)).toBe("· reasoning\n  thinking\n");
	});

	test("preserves blank reasoning lines and italic styling", () => {
		captureStdout();
		const block = new LiveReasoningBlock();

		block.append("line 1\n\nline 3");
		block.finish();

		expect(stripAnsi(stdout)).toBe("· reasoning\n  line 1\n  \n  line 3\n");
		expect(stdout.includes("\x1b[3m")).toBe(true);
	});
});
