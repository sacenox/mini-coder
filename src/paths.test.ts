import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalizePath, isSamePath } from "./paths.ts";

describe("paths", () => {
  test("canonicalizePath resolves symlinked directories", () => {
    const tmp = mkdtempSync(join(tmpdir(), "mc-paths-"));

    try {
      const realDir = join(tmp, "real");
      const linkedDir = join(tmp, "linked");
      mkdirSync(realDir, { recursive: true });
      symlinkSync(realDir, linkedDir);

      expect(canonicalizePath(linkedDir)).toBe(canonicalizePath(realDir));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("isSamePath returns true for logical and canonical spellings", () => {
    const tmp = mkdtempSync(join(tmpdir(), "mc-paths-"));

    try {
      const realDir = join(tmp, "real");
      const linkedDir = join(tmp, "linked");
      mkdirSync(realDir, { recursive: true });
      symlinkSync(realDir, linkedDir);

      expect(isSamePath(realDir, linkedDir)).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
