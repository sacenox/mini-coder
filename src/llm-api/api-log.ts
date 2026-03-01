import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let writer: ReturnType<ReturnType<typeof Bun.file>["writer"]> | null = null;

export function initApiLog(): void {
	if (writer) return;

	const dirPath = join(homedir(), ".config", "mini-coder");
	const logPath = join(dirPath, "api.log");

	mkdirSync(dirPath, { recursive: true });

	// Truncate on open so it doesn't grow forever between sessions
	writer = Bun.file(logPath).writer();
}

export function logApiEvent(event: string, data?: unknown): void {
	if (!writer) return;

	const timestamp = new Date().toISOString();
	let entry = `[${timestamp}] ${event}\n`;

	if (data !== undefined) {
		try {
			entry += JSON.stringify(data, null, 2)
				.split("\n")
				.map((line) => `  ${line}`)
				.join("\n");
			entry += "\n";
		} catch (err) {
			entry += `  [Error stringifying data: ${String(err)}]\n`;
		}
	}

	entry += "---\n";
	writer.write(entry);
	writer.flush();
}
