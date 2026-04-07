import { expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = join(import.meta.dir, "..");
const INDEX_MODULE_URL = pathToFileURL(join(import.meta.dir, "index.ts")).href;

async function importIndexInChild(): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `await import(${JSON.stringify(INDEX_MODULE_URL)}); process.stdout.write("imported\\n");`,
    ],
    {
      cwd: REPO_ROOT,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    },
  );

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      proc.kill();
      reject(new Error("Timed out waiting for index import to exit"));
    }, 1_000);
  });

  let exitCode: number;
  try {
    exitCode = await Promise.race([proc.exited, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  return { exitCode, stdout, stderr };
}

test("importing index.ts does not start the CLI", async () => {
  const result = await importIndexInChild();

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("imported\n");
  expect(result.stderr).toBe("");
});
