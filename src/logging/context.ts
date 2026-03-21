import type { LogsRepo } from "../session/db/logs-repo.ts";

/**
 * Logging context that holds the session ID and logs repo.
 * This is used to log errors and API events to the database.
 */
interface LogContext {
  sessionId: string;
  logsRepo: LogsRepo;
}

let _currentContext: LogContext | null = null;

export function setLogContext(context: LogContext | null): void {
  _currentContext = context;
}

export function getLogContext(): LogContext | null {
  return _currentContext;
}

/**
 * Log an error to the database if a context is set.
 * This is a simple wrapper that checks for context before writing.
 */
export function logError(err: unknown, context?: string): void {
  const logCtx = _currentContext;
  if (!logCtx) return;

  logCtx.logsRepo.write(logCtx.sessionId, "error", { error: err, context });
}

/**
 * Log an API event to the database if a context is set.
 * This is a simple wrapper that checks for context before writing.
 */
export function logApiEvent(event: string, data?: unknown): void {
  const logCtx = _currentContext;
  if (!logCtx) return;

  logCtx.logsRepo.write(logCtx.sessionId, "api", { event, data });
}
