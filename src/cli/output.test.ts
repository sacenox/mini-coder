import { afterEach, describe, expect, test } from "bun:test";
import { renderBanner, renderUserMessage } from "./output.ts";
import {
	captureStdout,
	getCapturedStdout,
	restoreStdout,
	stripAnsi,
} from "./test-helpers.ts";

afterEach(() => {
	restoreStdout();
});

describe("renderUserMessage", () => {
	test("renders a compact single-line prompt entry", () => {
		captureStdout();

		renderUserMessage("ship it");

		expect(stripAnsi(getCapturedStdout())).toBe("› ship it\n");
	});

	test("preserves multiline prompts as an indented history block", () => {
		captureStdout();

		renderUserMessage("plan\nstep 1\n\nstep 2");

		expect(stripAnsi(getCapturedStdout())).toBe(
			"› plan\n  step 1\n  \n  step 2\n",
		);
	});
});

describe("renderBanner", () => {
	test("uses a tilde path in the header", () => {
		captureStdout();

		renderBanner("zen/gpt-5.4", `${process.env.HOME}/src/mini-coder`);

		expect(stripAnsi(getCapturedStdout())).toContain(
			"zen/gpt-5.4  ·  ~/src/mini-coder",
		);
	});
});
