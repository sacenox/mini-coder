import { describe, expect, test } from "bun:test";
import { Readable } from "node:stream";
import { resolvePromptInput } from "./stdin-prompt.ts";

describe("resolvePromptInput", () => {
	test("keeps explicit prompt argument", async () => {
		const prompt = await resolvePromptInput("hello", {
			stdin: Readable.from(["ignored"]),
			stdinIsTTY: false,
		});

		expect(prompt).toBe("hello");
	});

	test("reads piped stdin when no prompt argument", async () => {
		const prompt = await resolvePromptInput(null, {
			stdin: Readable.from(["  explain\nthis file\n  "]),
			stdinIsTTY: false,
		});

		expect(prompt).toBe("explain\nthis file");
	});

	test("returns null for empty piped input", async () => {
		const prompt = await resolvePromptInput(null, {
			stdin: Readable.from(["\n  \t  \n"]),
			stdinIsTTY: false,
		});

		expect(prompt).toBeNull();
	});

	test("returns null when stdin is a tty", async () => {
		const prompt = await resolvePromptInput(null, {
			stdin: Readable.from(["ignored"]),
			stdinIsTTY: true,
		});

		expect(prompt).toBeNull();
	});
});
