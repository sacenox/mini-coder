import { describe, expect, test } from "bun:test";
import { SPINNER_FRAMES, Spinner } from "./spinner.ts";

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
	test("moves cursor to a new line when stopped", () => {
		const originalWrite = process.stderr.write;
		let stderr = "";
		process.stderr.write = ((text: string) => {
			stderr += text;
			return true;
		}) as typeof process.stderr.write;

		try {
			const spinner = new Spinner();
			spinner.start("thinking");
			spinner.stop();
			expect(stderr).toContain("\n");
		} finally {
			process.stderr.write = originalWrite;
		}
	});
});
