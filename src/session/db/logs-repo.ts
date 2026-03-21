import type { Database as DatabaseType } from "bun:sqlite";

interface Log {
  id: number;
  session_id: string;
  level: "error" | "api";
  timestamp: number;
  data: unknown;
}

export class LogsRepo {
  constructor(private db: DatabaseType) {}

  write(sessionId: string, level: "error" | "api", data: unknown): void {
    const timestamp = Date.now();
    const serialized =
      data === undefined ? "{}" : JSON.stringify(this.sanitize(data));

    this.db.run(
      `INSERT INTO logs (session_id, level, timestamp, data)
       VALUES (?, ?, ?, ?)`,
      [sessionId, level, timestamp, serialized],
    );
  }

  /**
   * Retrieve logs for a session, optionally filtered by level.
   * Returns rows in ascending timestamp order (oldest first).
   */
  getLogs(
    sessionId: string,
    level?: "error" | "api",
  ): Array<Omit<Log, "data"> & { data: string }> {
    let sql = `SELECT id, session_id, level, timestamp, data
               FROM logs
               WHERE session_id = ?`;

    if (level) {
      sql += ` AND level = ?`;
      const params: [string, string] = [sessionId, level];
      return this.db
        .query<Omit<Log, "data"> & { data: string }, [string, string]>(sql)
        .all(...params);
    }

    sql += ` ORDER BY timestamp ASC`;
    const params: [string] = [sessionId];
    return this.db
      .query<Omit<Log, "data"> & { data: string }, [string]>(sql)
      .all(...params);
  }

  /**
   * Delete logs older than the given timestamp (useful for cleanup).
   */
  deleteOldLogs(beforeTimestamp: number): number {
    return this.db.run(`DELETE FROM logs WHERE timestamp < ?`, [
      beforeTimestamp,
    ]).changes;
  }

  /**
   * Delete all logs for a session (called on session deletion).
   */
  deleteSessionLogs(sessionId: string): number {
    return this.db.run(`DELETE FROM logs WHERE session_id = ?`, [sessionId])
      .changes;
  }

  /**
   * Strip large/opaque fields from error objects before serialization.
   * AI SDK errors embed full `requestBodyValues` and `responseBody` —
   * serializing these can produce tens of megabytes per error.
   */
  private sanitize(data: unknown): unknown {
    if (!this.isObject(data)) return data;

    const dropKeys = new Set([
      "requestBodyValues",
      "responseBody",
      "responseHeaders",
      "stack",
    ]);

    const result: Record<string, unknown> = {};
    for (const key in data) {
      if (dropKeys.has(key)) continue;
      const value = data[key];
      if (key === "errors" && Array.isArray(value)) {
        result[key] = value.map((e) => this.sanitize(e));
      } else if (key === "lastError" && this.isObject(value)) {
        result[key] = this.sanitize(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null;
  }
}
