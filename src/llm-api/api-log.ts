import { writeFileSync } from "node:fs";

import { pidLogPath } from "../cli/log-paths.ts";

let writer: ReturnType<ReturnType<typeof Bun.file>["writer"]> | null = null;

/** Cap individual log entries to prevent unbounded serialization (e.g. RetryError
 *  objects that embed the full requestBodyValues / conversation history). */
const MAX_ENTRY_BYTES = 8 * 1024;

export function initApiLog(): void {
	if (writer) return;

	const logPath = pidLogPath("api");

	// Truncate on open so each session starts fresh
	writeFileSync(logPath, "");
	writer = Bun.file(logPath).writer();
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}

/**
 * Strip large/opaque fields from error objects before serialization.
 * AI SDK errors embed full `requestBodyValues` (the entire conversation) and
 * `responseBody` (full HTML error pages) — serializing these can produce
 * tens of megabytes per error and block the event loop on flush.
 */
const LOG_DROP_KEYS = new Set([
	"requestBodyValues",
	"responseBody",
	"responseHeaders",
	"stack",
]);

function sanitizeForLog(data: unknown): unknown {
	if (!isObject(data)) return data;

	const result: Record<string, unknown> = {};
	for (const key in data) {
		if (LOG_DROP_KEYS.has(key)) continue;
		const value = data[key];
		if (key === "errors" && Array.isArray(value)) {
			result[key] = value.map((e) => sanitizeForLog(e));
		} else if (key === "lastError" && isObject(value)) {
			result[key] = sanitizeForLog(value);
		} else {
			result[key] = value;
		}
	}
	return result;
}

/** Returns true when the API log file writer is active. */
export function isApiLogEnabled(): boolean {
	return writer !== null;
}

export function logApiEvent(event: string, data?: unknown): void {
	if (!writer) return;

	const timestamp = new Date().toISOString();
	let entry = `[${timestamp}] ${event}\n`;

	if (data !== undefined) {
		try {
			const safe = sanitizeForLog(data);
			let serialized = JSON.stringify(safe, null, 2);
			if (serialized.length > MAX_ENTRY_BYTES) {
				serialized = `${serialized.slice(0, MAX_ENTRY_BYTES)}\n  …truncated`;
			}
			entry += serialized
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
