import { expect, test } from "bun:test";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");

async function packDryRun(): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn(
    [process.execPath, "pm", "pack", "--dry-run", "--ignore-scripts"],
    {
      cwd: REPO_ROOT,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    },
  );

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  return { exitCode, stdout, stderr };
}

test("package.json bin points to a checked-in mc launcher", async () => {
  const pkg = (await Bun.file(join(REPO_ROOT, "package.json")).json()) as {
    bin?: Record<string, string>;
  };

  expect(pkg.bin).toEqual({ mc: "bin/mc.ts" });

  const launcher = pkg.bin?.mc;
  expect(launcher).toBe("bin/mc.ts");
  if (!launcher) {
    throw new Error("package.json bin.mc is missing");
  }
  expect(Bun.file(join(REPO_ROOT, launcher)).size).toBeGreaterThan(0);
});

test("package.json declares direct UI types and omits redundant diff typings", async () => {
  const pkg = (await Bun.file(join(REPO_ROOT, "package.json")).json()) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  expect(pkg.dependencies).toHaveProperty("@cel-tui/types");
  expect(pkg.devDependencies).not.toHaveProperty("@types/diff");
});

test("pack dry-run includes the mc launcher and runtime entrypoint", async () => {
  const result = await packDryRun();

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("packed ");
  expect(result.stdout).toContain("bin/mc.ts");
  expect(result.stdout).toContain("src/index.ts");
  expect(result.stdout).not.toContain("src/package.test.ts");
});
