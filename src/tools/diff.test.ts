import { describe, expect, test } from "bun:test";
import { generateDiff } from "./diff.ts";

describe("generateDiff", () => {
	test("returns (no changes) when before and after are identical", () => {
		const content = "line1\nline2\nline3\n";
		expect(generateDiff("file.txt", content, content)).toBe("(no changes)");
	});

	test("handles empty before (new file)", () => {
		const after = "alpha\nbeta\ngamma\n";
		const result = generateDiff("new.txt", "", after);
		expect(result).toContain("+alpha");
		expect(result).toContain("+beta");
		expect(result).toContain("+gamma");
		// No lines should be marked as removed (--- header is expected, diff lines are not)
		expect(result).not.toMatch(/^-[^-]/m);
		// New-file hunk header must use start=0 for the before side
		expect(result).toMatch(/@@ -0,0 \+1,\d+ @@/);
	});

	test("handles empty after (file deleted / cleared)", () => {
		const before = "alpha\nbeta\ngamma\n";
		const result = generateDiff("old.txt", before, "");
		expect(result).toContain("-alpha");
		expect(result).toContain("-beta");
		expect(result).toContain("-gamma");
		expect(result).not.toMatch(/^\+[^+]/m);
		// Cleared-file hunk header must use start=0 for the after side
		expect(result).toMatch(/@@ -1,\d+ \+0,0 @@/);
	});

	test("appending lines shows only added lines as +", () => {
		const before = "a\nb\nc\n";
		const after = "a\nb\nc\nd\ne\n";
		const result = generateDiff("f.txt", before, after);
		expect(result).toContain("+d");
		expect(result).toContain("+e");
		// 'a', 'b', 'c' must not appear as removed
		expect(result).not.toContain("-a");
		expect(result).not.toContain("-b");
		expect(result).not.toContain("-c");
	});

	test("deleting lines from the middle shows only removed lines as -", () => {
		const before = "a\nb\nc\nd\ne\n";
		const after = "a\nd\ne\n";
		const result = generateDiff("f.txt", before, after);
		expect(result).toContain("-b");
		expect(result).toContain("-c");
		// unchanged lines must not appear as added
		expect(result).not.toContain("+a");
		expect(result).not.toContain("+d");
		expect(result).not.toContain("+e");
	});

	test("replacing a middle line does not mark surrounding unchanged lines as changed", () => {
		// This was the core bug: lines after the change were shown as both - and +
		const lines = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
		const before = lines.join("\n");
		const after = [
			"1",
			"2",
			"3",
			"CHANGED",
			"5",
			"6",
			"7",
			"8",
			"9",
			"10",
		].join("\n");
		const result = generateDiff("f.txt", before, after);

		expect(result).toContain("-4");
		expect(result).toContain("+CHANGED");
		// Lines 5-10 are unchanged and must not appear as - or +
		for (const line of ["5", "6", "7", "8", "9", "10"]) {
			expect(result).not.toMatch(new RegExp(`^-${line}$`, "m"));
			expect(result).not.toMatch(new RegExp(`^\\+${line}$`, "m"));
		}
	});

	test("two disjoint changes produce two separate hunks", () => {
		// Change line 1 and line 20, with 14+ unchanged lines between them
		const beforeLines = Array.from({ length: 22 }, (_, i) => `line${i + 1}`);
		const afterLines = [...beforeLines];
		afterLines[0] = "FIRST";
		afterLines[21] = "LAST";
		const before = beforeLines.join("\n");
		const after = afterLines.join("\n");

		const result = generateDiff("f.txt", before, after);
		// Two @@ hunk headers expected
		const hunkCount = (result.match(/^@@/gm) ?? []).length;
		expect(hunkCount).toBe(2);

		expect(result).toContain("-line1");
		expect(result).toContain("+FIRST");
		expect(result).toContain("-line22");
		expect(result).toContain("+LAST");
	});

	test("hunk header has correct --- / +++ file path", () => {
		const result = generateDiff("src/foo.ts", "old\n", "new\n");
		expect(result).toContain("--- src/foo.ts");
		expect(result).toContain("+++ src/foo.ts");
	});

	test("hunk @@ line counts are accurate", () => {
		// Replace one line in a 5-line file; hunk should cover all 5 lines
		// with context (3 before + changed + 1 after, but clamped to file size)
		const before = "a\nb\nc\nd\ne";
		const after = "a\nb\nX\nd\ne";
		const result = generateDiff("f.txt", before, after);
		// Extract the @@ line
		const match = result.match(/@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
		expect(match).not.toBeNull();
		const [, , beforeCount, , afterCount] = match ?? [];
		expect(Number(beforeCount)).toBe(5);
		expect(Number(afterCount)).toBe(5);
	});
});
