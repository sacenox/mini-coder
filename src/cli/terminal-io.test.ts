import { afterEach, describe, expect, test } from "bun:test";
import { terminal } from "./terminal-io.ts";

const originalWrite = terminal.stderrWrite.bind(terminal);
const originalIsTTY = process.stderr.isTTY;

afterEach(() => {
	terminal.stderrWrite = originalWrite;
	process.stderr.isTTY = originalIsTTY;
});

describe("terminal.restoreTerminal", () => {
	test("does not write cursor control escapes when stderr is not a TTY", () => {
		let output = "";
		terminal.stderrWrite = (text: string) => {
			output += text;
		};
		process.stderr.isTTY = false;

		terminal.restoreTerminal();

		expect(output).toBe("");
	});

	test("writes cursor restore escapes when stderr is a TTY", () => {
		let output = "";
		terminal.stderrWrite = (text: string) => {
			output += text;
		};
		process.stderr.isTTY = true;

		terminal.restoreTerminal();

		expect(output).toContain("\x1B[?25h");
		expect(output).toContain("\r\x1B[2K");
	});
});
