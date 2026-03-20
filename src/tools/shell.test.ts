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
});
