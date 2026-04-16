import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autocompleteInputPath, findInputPathMatches } from "./input.ts";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mini-coder-ui-input-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("ui/input", () => {
  test("autocompleteInputPath completes the last file path token when exactly one match is available", () => {
    const cwd = createTempDir();
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src", "ui.ts"), "", "utf-8");

    expect(autocompleteInputPath("inspect src/u", cwd)).toBe(
      "inspect src/ui.ts",
    );
  });

  test("autocompleteInputPath returns null when multiple matches are available", () => {
    const cwd = createTempDir();
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src", "ui.ts"), "", "utf-8");
    writeFileSync(join(cwd, "src", "utils.ts"), "", "utf-8");

    expect(autocompleteInputPath("inspect src/u", cwd)).toBeNull();
  });

  test("findInputPathMatches returns sorted selectable matches for the last file path token", () => {
    const cwd = createTempDir();
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src", "alpine.ts"), "", "utf-8");
    writeFileSync(join(cwd, "src", "alpha.ts"), "", "utf-8");

    expect(findInputPathMatches("inspect src/al", cwd)).toEqual([
      {
        label: "src/alpha.ts",
        value: "inspect src/alpha.ts",
      },
      {
        label: "src/alpine.ts",
        value: "inspect src/alpine.ts",
      },
    ]);
  });

  test("autocompleteInputPath returns null when no completion is available", () => {
    const cwd = createTempDir();

    expect(autocompleteInputPath("inspect src/u", cwd)).toBeNull();
  });
});
