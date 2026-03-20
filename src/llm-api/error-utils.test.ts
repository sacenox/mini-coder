import { describe, expect, test } from "bun:test";
import { normalizeUnknownError } from "./error-utils.ts";

describe("normalizeUnknownError", () => {
  test("returns existing Error instances with messages", () => {
    const error = new Error("boom");
    expect(normalizeUnknownError(error)).toBe(error);
  });

  test("preserves empty-message Error metadata", () => {
    const error = Object.assign(new Error(""), { code: "ECONNRESET" });
    const normalized = normalizeUnknownError(error) as Error & {
      code?: string;
    };
    expect(normalized).toBe(error);
    expect(normalized.code).toBe("ECONNRESET");
  });

  test("prefers shallow nested object message", () => {
    expect(
      normalizeUnknownError({ error: { message: "model_not_found" } }).message,
    ).toBe("model_not_found");
  });

  test("falls back to Unknown error for circular objects", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(normalizeUnknownError(circular).message).toBe("Unknown error");
  });
});
