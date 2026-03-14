import { describe, expect, test } from "bun:test";
import { SPINNER_FRAMES, Spinner } from "./spinner.ts";
import { terminal } from "./terminal-io.ts";

const BRAILLE_BASE = 0x2800;
const BRAILLE_DOT_7 = 1 << 6;
const BRAILLE_DOT_8 = 1 << 7;

describe("SPINNER_FRAMES", () => {
	test("uses the bottom braille row in every frame so the spinner stays 4 dots tall", () => {
		for (const frame of SPINNER_FRAMES) {
			const pattern = frame.codePointAt(0);
			expect(pattern).toBeDefined();
			const dots = (pattern ?? BRAILLE_BASE) - BRAILLE_BASE;
			expect((dots & (BRAILLE_DOT_7 | BRAILLE_DOT_8)) !== 0).toBe(true);
		}
	});
});

describe("Spinner", () => {
	test("clears the spinner line and shows cursor without advancing to a new line", () => {
		const originalWrite = terminal.stderrWrite.bind(terminal);
		const originalIsTTY = process.stderr.isTTY;
		let stderr = "";
		terminal.stderrWrite = (text: string) => {
			stderr += text;
		};
		process.stderr.isTTY = true;

		try {
			const spinner = new Spinner();
			spinner.start("thinking");
			spinner.stop();
			expect(stderr).toContain("\r\x1B[2K");
			expect(stderr).toContain("\x1B[?25h");
			expect(stderr).not.toContain("\n");
		} finally {
			terminal.stderrWrite = originalWrite;
			process.stderr.isTTY = originalIsTTY;
		}
	});
});
