import { describe, expect, it } from "bun:test";
import { shellTool } from "./shell.ts";

describe("shellTool", () => {
	it("captures stdout", async () => {
		const result = await shellTool.execute({
			command: "printf ok",
			timeout: 30_000,
		});

		expect(result.stdout).toBe("ok");
		expect(result.success).toBe(true);
	});

	it("injects mc-edit into shell commands", async () => {
		const result = await shellTool.execute({
			command: "mc-edit --help >/dev/null",
			timeout: 30_000,
		});

		expect(result.success).toBe(true);
		expect(result.exitCode).toBe(0);
	});
});

describe.skipIf(!process.stdin.isTTY)("shellTool raw mode", () => {
	it("preserves stdin raw mode if it was enabled", async () => {
		// Set raw mode to true initially
		process.stdin.setRawMode(true);
		expect(process.stdin.isRaw).toBe(true);

		// Execute a quick command
		await shellTool.execute({ command: "echo hello", timeout: 30_000 });

		// Verify it restored raw mode
		expect(process.stdin.isRaw).toBe(true);

		// Clean up
		process.stdin.setRawMode(false);
	});

	it("leaves raw mode disabled if it was disabled", async () => {
		// Ensure raw mode is false
		process.stdin.setRawMode(false);
		expect(process.stdin.isRaw).toBe(false);

		// Execute a quick command
		await shellTool.execute({ command: "echo hello", timeout: 30_000 });

		// Verify it stayed false
		expect(process.stdin.isRaw).toBe(false);
	});
});
