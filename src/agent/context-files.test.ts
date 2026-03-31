import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverContextFiles } from "./context-files.ts";

describe("discoverContextFiles", () => {
  let fakeHome = "";
  let repoRoot = "";

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "mc-context-home-"));
    repoRoot = mkdtempSync(join(tmpdir(), "mc-context-repo-"));
    mkdirSync(join(repoRoot, ".git"));
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  });

  test("shows nearest parent local context files for subdirectories", () => {
    mkdirSync(join(fakeHome, ".agents"), { recursive: true });
    writeFileSync(join(fakeHome, ".agents", "AGENTS.md"), "global");
    writeFileSync(join(repoRoot, "AGENTS.md"), "root agents");
    const cwd = join(repoRoot, "src", "cli");
    mkdirSync(cwd, { recursive: true });

    expect(discoverContextFiles(cwd, fakeHome)).toEqual([
      "~/.agents/AGENTS.md",
      resolve(repoRoot, "AGENTS.md"),
    ]);
  });

  test("uses the nearest local context directory for AGENTS.md and CLAUDE.md", () => {
    writeFileSync(join(repoRoot, "AGENTS.md"), "root agents");
    const appDir = join(repoRoot, "packages", "app");
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, "CLAUDE.md"), "app claude");
    const cwd = join(appDir, "src");
    mkdirSync(cwd, { recursive: true });

    expect(discoverContextFiles(cwd, fakeHome)).toEqual([
      resolve(appDir, "CLAUDE.md"),
    ]);
  });
});
