import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEV_VERSION_LABEL, resolveAppVersionLabel } from "./version.ts";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mc-version-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveAppVersionLabel returns the packaged version when no repo metadata is present", () => {
  const root = createTempDir();
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "mini-coder", version: "1.2.3" }),
    "utf-8",
  );

  expect(resolveAppVersionLabel(root)).toBe("v1.2.3");
});

test("resolveAppVersionLabel falls back to the dev label inside a git checkout", () => {
  const root = createTempDir();
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "mini-coder", version: "1.2.3" }),
    "utf-8",
  );
  mkdirSync(join(root, ".git"));

  expect(resolveAppVersionLabel(root)).toBe(DEV_VERSION_LABEL);
});

test("resolveAppVersionLabel falls back to the dev label when package metadata is unreadable", () => {
  const root = createTempDir();
  writeFileSync(join(root, "package.json"), "{not json", "utf-8");

  expect(resolveAppVersionLabel(root)).toBe(DEV_VERSION_LABEL);
});
