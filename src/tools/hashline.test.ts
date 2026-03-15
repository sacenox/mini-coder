import { describe, expect, test } from "bun:test";
import { formatHashLine } from "./hashline.ts";

describe("formatHashLine", () => {
	test("formats the line number, short hash, and content", () => {
		const formatted = formatHashLine(12, "alpha");
		expect(formatted).toMatch(/^12:[0-9a-f]{2}\| alpha$/);
	});

	test("keeps the same hash for the same content", () => {
		expect(formatHashLine(1, "hello")).toBe(formatHashLine(1, "hello"));
	});
});
