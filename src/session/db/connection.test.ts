import { describe, expect, test } from "bun:test";
import { isSqliteBusyError } from "./connection.ts";

describe("isSqliteBusyError", () => {
  test("matches sqlite busy messages", () => {
    expect(
      isSqliteBusyError(new Error("SQLiteError: database is locked")),
    ).toBe(true);
    expect(
      isSqliteBusyError(new Error("SQLITE_BUSY: database is locked")),
    ).toBe(true);
  });

  test("ignores unrelated errors", () => {
    expect(isSqliteBusyError(new Error("network timeout"))).toBe(false);
    expect(isSqliteBusyError("database is locked")).toBe(false);
  });
});
