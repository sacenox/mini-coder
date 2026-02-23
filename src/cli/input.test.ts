import { describe, expect, test } from "bun:test";
import { pasteLabel } from "./input.ts";

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
