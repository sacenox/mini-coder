import { writeFileSync } from "node:fs";

import { pidLogPath } from "./log-paths.ts";

let writer: ReturnType<ReturnType<typeof Bun.file>["writer"]> | null = null;

export function initErrorLog(): void {
	if (writer) return;

	const logPath = pidLogPath("errors");

	// Truncate on open so each session starts fresh
	writeFileSync(logPath, "");
	writer = Bun.file(logPath).writer();

	process.on("uncaughtException", (err) => {
		logError(err, "uncaught");
		process.exit(1);
	});
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}

export function logError(err: unknown, context?: string): void {
	if (!writer) return;

	let entry = `[${new Date().toISOString()}]`;
	if (context) entry += ` context=${context}`;
	entry += "\n";

	if (isObject(err)) {
		if (typeof err.name === "string") entry += `  name: ${err.name}\n`;
		if (typeof err.message === "string") entry += `  message: ${err.message}\n`;
		if ("statusCode" in err) entry += `  statusCode: ${err.statusCode}\n`;
		if ("url" in err) entry += `  url: ${err.url}\n`;
		if ("isRetryable" in err) entry += `  isRetryable: ${err.isRetryable}\n`;
		if (typeof err.stack === "string") {
			const indentedStack = err.stack
				.split("\n")
				.map((line, i) => (i === 0 ? line : `  ${line}`))
				.join("\n");
			entry += `  stack: ${indentedStack}\n`;
		}
	} else {
		entry += `  value: ${String(err)}\n`;
	}

	entry += "---\n";
	writer.write(entry);
	writer.flush();
}
