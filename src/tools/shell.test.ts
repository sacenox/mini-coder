import { describe, expect, it, mock } from "bun:test";
import { shellTool } from "./shell.ts";

function collectOutput(mockFn: ReturnType<typeof mock>): string {
	return mockFn.mock.calls.map((call) => String(call[0] ?? "")).join("");
}

async function expectStreamedOutput(command: string, expectedOutput: string) {
	const onOutput = mock(() => {});
	const result = await shellTool.execute({
		command,
		timeout: 30_000,
		onOutput,
	});

	expect(result.stdout).toBe(expectedOutput.trimEnd());
	expect(result.streamedOutput).toBe(true);
	expect(collectOutput(onOutput)).toBe(expectedOutput);
}

describe("shellTool", () => {
	it("appends a newline to streamed output when the command does not print one", async () => {
		await expectStreamedOutput("printf ok", "ok\n");
	});

	it("does not duplicate a trailing newline in streamed output", async () => {
		await expectStreamedOutput("printf 'ok\\n'", "ok\n");
	});

	it("marks output as not streamed when no onOutput handler is provided", async () => {
		const result = await shellTool.execute({
			command: "printf ok",
			timeout: 30_000,
		});

		expect(result.stdout).toBe("ok");
		expect(result.streamedOutput).toBe(false);
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
