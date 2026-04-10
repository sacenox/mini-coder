import { describe, expect, test } from "bun:test";
import { getErrorMessage } from "./errors.ts";

describe("errors", () => {
  test("getErrorMessage returns an Error message and stringifies non-Errors", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
    expect(getErrorMessage("plain failure")).toBe("plain failure");
    expect(getErrorMessage(42)).toBe("42");
  });
});
