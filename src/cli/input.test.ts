import { describe, expect, test } from "bun:test";
import { getTurnControlAction, pasteLabel } from "./input.ts";

describe("pasteLabel", () => {
	test("single short line", () => {
		expect(pasteLabel("hello world")).toBe('[pasted: "hello world"]');
	});

	test("single line truncated at 40 chars", () => {
		const long = "a".repeat(50);
		const label = pasteLabel(long);
		expect(label).toBe(`[pasted: "${"a".repeat(40)}…"]`);
	});

	test("multi-line shows extra count", () => {
		expect(pasteLabel("line one\nline two\nline three")).toBe(
			'[pasted: "line one" +2 more lines]',
		);
	});

	test("two lines says singular", () => {
		expect(pasteLabel("first\nsecond")).toBe('[pasted: "first" +1 more line]');
	});

	test("empty string", () => {
		expect(pasteLabel("")).toBe('[pasted: ""]');
	});
});

describe("getTurnControlAction", () => {
	test("treats ESC as cancel", () => {
		expect(getTurnControlAction(new Uint8Array([0x1b]))).toBe("cancel");
	});

	test("treats Ctrl+C as quit", () => {
		expect(getTurnControlAction(new Uint8Array([0x03]))).toBe("quit");
	});

	test("uses the first matching control byte in the chunk", () => {
		expect(getTurnControlAction(new Uint8Array([0x03, 0x1b]))).toBe("quit");
		expect(getTurnControlAction(new Uint8Array([0x1b, 0x03]))).toBe("cancel");
	});

	test("ignores unrelated bytes", () => {
		expect(getTurnControlAction(new Uint8Array([0x61, 0x62, 0x63]))).toBeNull();
	});
});
