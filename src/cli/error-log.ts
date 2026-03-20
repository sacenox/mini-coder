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

export function logError(err: unknown, context?: string): void {
  if (!writer) return;
  writer.write(`Error: ${JSON.stringify(err)}\n\nContext: ${context}`);
  writer.flush();
}
