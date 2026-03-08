import { describe, expect, test } from "bun:test";
import { findLineByHash, formatHashLine, hashLine } from "./hashline.ts";

describe("hashLine", () => {
	test("returns a stable two-character lowercase hex digest", () => {
		const hash = hashLine("hello");
		expect(hash).toHaveLength(2);
		expect(hash).toMatch(/^[0-9a-f]{2}$/);
		expect(hashLine("hello")).toBe(hash);
	});
});

describe("formatHashLine", () => {
	test("formats the line number, hash, and content", () => {
		expect(formatHashLine(12, "alpha")).toBe(`12:${hashLine("alpha")}| alpha`);
	});
});

describe("findLineByHash", () => {
	test("returns the hinted line when it matches exactly", () => {
		const lines = ["alpha", "beta", "gamma", "beta"];
		expect(findLineByHash(lines, hashLine("beta"), 2)).toBe(2);
	});

	test("finds a unique nearby match within the scan range", () => {
		const lines = ["alpha", "beta", "gamma", "delta"];
		expect(findLineByHash(lines, hashLine("gamma"), 2)).toBe(3);
	});

	test("treats anchor hashes case-insensitively", () => {
		const lines = ["alpha", "beta"];
		expect(findLineByHash(lines, hashLine("beta").toUpperCase(), 1)).toBe(2);
	});

	test("returns null when nearby matches are ambiguous", () => {
		const lines = ["alpha", "beta", "gamma", "beta"];
		expect(findLineByHash(lines, hashLine("beta"), 3)).toBeNull();
	});

	test("returns null when the only match is outside the scan range", () => {
		const lines = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`);
		lines[22] = "needle";
		expect(findLineByHash(lines, hashLine("needle"), 1)).toBeNull();
	});
});
