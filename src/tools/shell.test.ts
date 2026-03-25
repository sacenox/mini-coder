import { describe, expect, it } from "bun:test";
import { shellTool } from "./shell.ts";

describe("shellTool", () => {
  it("captures stdout", async () => {
    const result = await shellTool.execute({
      command: "printf ok",
      timeout: 30_000,
    });

    expect(result.stdout).toBe("ok");
    expect(result.success).toBe(true);
  });

  it("injects mc-edit into shell commands", async () => {
    const result = await shellTool.execute({
      command: "mc-edit --help >/dev/null",
      timeout: 30_000,
    });

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("does not truncate normal code-sized stdout under 24KB", async () => {
    const result = await shellTool.execute({
      command: "head -c 15000 /dev/zero | tr '\\0' a",
      timeout: 30_000,
    });

    expect(result.stdout).toHaveLength(15_000);
    expect(result.stdout).not.toContain("[output truncated]");
    expect(result.success).toBe(true);
  });

  it("still truncates very large stdout above 24KB", async () => {
    const result = await shellTool.execute({
      command: "head -c 30000 /dev/zero | tr '\\0' a",
      timeout: 30_000,
    });

    expect(result.stdout).toContain("[output truncated]");
    expect(result.success).toBe(true);
  });
});

it("kills the process when abort signal fires", async () => {
  const ac = new AbortController();

  // Start a long-running sleep
  const promise = shellTool.execute(
    { command: "sleep 60", timeout: null },
    { signal: ac.signal },
  );

  // Abort after 100ms
  setTimeout(() => ac.abort(), 100);

  const result = await promise;
  // Process should have been killed, not run for 60s
  expect(result.success).toBe(false);
});
