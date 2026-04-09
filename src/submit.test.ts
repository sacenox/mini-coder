import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRawInput } from "./submit.ts";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mc-submit-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("submit", () => {
  test("resolveRawInput returns a user-facing error when a referenced skill file cannot be read", () => {
    const result = resolveRawInput("/skill:code-review audit the diff", {
      model: null,
      cwd: tmp,
      skills: [
        {
          name: "code-review",
          description: "Review code changes.",
          path: join(tmp, "missing", "SKILL.md"),
        },
      ],
    });

    expect(result.type).toBe("error");
    if (result.type !== "error") {
      throw new Error("Expected an error result");
    }
    expect(result.message).toContain("Failed to read skill code-review:");
  });
});
