import { describe, expect, test } from "bun:test";
import { renderUnifiedDiff, writeJsonLine } from "./structured-output.ts";

function stripAnsi(text: string): string {
	const esc = String.fromCharCode(0x1b);
	return text.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "");
}

describe("renderUnifiedDiff", () => {
	test("renders a colored unified diff without legacy index headers", () => {
		const output = renderUnifiedDiff("f.txt", "a\nb\nc\n", "a\nB\nc\n");

		expect(stripAnsi(output)).toBe(
			[
				"--- f.txt",
				"+++ f.txt",
				"@@ -1,3 +1,3 @@",
				" a",
				"-b",
				"+B",
				" c",
			].join("\n"),
		);
	});

	test("renders valid hunk headers when deleting all file contents", () => {
		const output = renderUnifiedDiff("f.txt", "x\n", "");

		expect(stripAnsi(output)).toBe(
			["--- f.txt", "+++ f.txt", "@@ -1,1 +0,0 @@", "-x"].join("\n"),
		);
	});

	test("renders valid hunk headers when inserting at the start of a file", () => {
		const output = renderUnifiedDiff("f.txt", "", "x\n");

		expect(stripAnsi(output)).toBe(
			["--- f.txt", "+++ f.txt", "@@ -0,0 +1,1 @@", "+x"].join("\n"),
		);
	});
});

describe("writeJsonLine", () => {
	test("writes one compact newline-delimited JSON object", () => {
		let output = "";

		writeJsonLine(
			(text) => {
				output += text;
			},
			{ ok: true, value: [1, 2, 3] },
		);

		expect(output).toBe('{"ok":true,"value":[1,2,3]}\n');
	});
});
