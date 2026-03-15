import { afterEach, describe, expect, test } from "bun:test";
import { CliReporter, renderBanner, renderUserMessage } from "./output.ts";
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

describe("renderBanner", () => {
	test("uses a tilde path in the header", () => {
		captureStdout();

		renderBanner("zen/gpt-5.4", `${process.env.HOME}/src/mini-coder`);

		expect(stripAnsi(stdout)).toContain("zen/gpt-5.4  ·  ~/src/mini-coder");
	});
});

describe("CliReporter live output", () => {
	test("groups streamed chunks into an indented output block", () => {
		captureStdout();
		const reporter = new CliReporter();

		reporter.streamChunk("hello");
		reporter.streamChunk("\nworld\n");
		reporter.info("done");

		expect(stripAnsi(stdout)).toBe("    │ hello\n    │ world\n· done\n");
	});

	test("flushes an unterminated streamed line before the next log line", () => {
		captureStdout();
		const reporter = new CliReporter();

		reporter.streamChunk("partial line");
		reporter.warn("next");

		expect(stripAnsi(stdout)).toBe("    │ partial line\n! next\n");
	});
});
