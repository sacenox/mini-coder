import { describe, expect, test } from "bun:test";
import { truncateText } from "./text.ts";

describe("truncateText", () => {
  test("returns short strings unchanged", () => {
    expect(truncateText("hello", 10)).toBe("hello");
  });

  test("truncates at exact boundary", () => {
    expect(truncateText("hello", 5)).toBe("hello");
  });

  test("truncates long strings with ellipsis", () => {
    expect(truncateText("hello world", 8)).toBe("hello w…");
  });

  test("handles max=1", () => {
    expect(truncateText("hello", 1)).toBe("…");
  });

  test("handles empty string", () => {
    expect(truncateText("", 5)).toBe("");
  });
});
