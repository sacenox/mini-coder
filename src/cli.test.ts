import { describe, expect, test } from "bun:test";
import {
  parseCliArgs,
  resolveHeadlessPrompt,
  shouldUseHeadlessMode,
} from "./cli.ts";

describe("cli", () => {
  test("parseCliArgs recognizes -p and --prompt", () => {
    expect(parseCliArgs(["-p", "fix the tests"])).toEqual({
      prompt: "fix the tests",
    });
    expect(parseCliArgs(["--prompt", "fix the tests"])).toEqual({
      prompt: "fix the tests",
    });
    expect(parseCliArgs(["--prompt=fix the tests"])).toEqual({
      prompt: "fix the tests",
    });
  });

  test("parseCliArgs rejects a missing prompt value", () => {
    expect(() => parseCliArgs(["-p"])).toThrow(
      "Missing value for -p/--prompt.",
    );
    expect(() => parseCliArgs(["--prompt"])).toThrow(
      "Missing value for -p/--prompt.",
    );
  });

  test("parseCliArgs rejects unknown arguments", () => {
    expect(() => parseCliArgs(["--wat"])).toThrow("Unknown argument: --wat");
    expect(() => parseCliArgs(["extra"])).toThrow(
      "Unexpected positional argument: extra",
    );
  });

  test("shouldUseHeadlessMode selects prompt mode or missing TTYs", () => {
    expect(
      shouldUseHeadlessMode(
        { prompt: null },
        { stdinIsTTY: true, stdoutIsTTY: true },
      ),
    ).toBe(false);
    expect(
      shouldUseHeadlessMode(
        { prompt: "fix the tests" },
        { stdinIsTTY: true, stdoutIsTTY: true },
      ),
    ).toBe(true);
    expect(
      shouldUseHeadlessMode(
        { prompt: null },
        { stdinIsTTY: false, stdoutIsTTY: true },
      ),
    ).toBe(true);
    expect(
      shouldUseHeadlessMode(
        { prompt: null },
        { stdinIsTTY: true, stdoutIsTTY: false },
      ),
    ).toBe(true);
  });

  test("resolveHeadlessPrompt prefers the CLI prompt and preserves whitespace", async () => {
    const prompt = await resolveHeadlessPrompt(
      { prompt: "  fix the tests  " },
      { stdinIsTTY: true, stdoutIsTTY: false },
      async () => {
        throw new Error("stdin should not be read");
      },
    );

    expect(prompt).toBe("  fix the tests  ");
  });

  test("resolveHeadlessPrompt reads piped stdin when no CLI prompt was provided", async () => {
    const prompt = await resolveHeadlessPrompt(
      { prompt: null },
      { stdinIsTTY: false, stdoutIsTTY: true },
      async () => "fix the tests\n",
    );

    expect(prompt).toBe("fix the tests\n");
  });

  test("resolveHeadlessPrompt rejects interactive stdin when stdout is not a TTY", async () => {
    await expect(
      resolveHeadlessPrompt(
        { prompt: null },
        { stdinIsTTY: true, stdoutIsTTY: false },
        async () => "",
      ),
    ).rejects.toThrow("Headless mode requires -p/--prompt or piped stdin.");
  });

  test("resolveHeadlessPrompt rejects empty headless input", async () => {
    await expect(
      resolveHeadlessPrompt(
        { prompt: "   \n\t" },
        { stdinIsTTY: true, stdoutIsTTY: false },
        async () => "",
      ),
    ).rejects.toThrow("Headless input is empty.");

    await expect(
      resolveHeadlessPrompt(
        { prompt: null },
        { stdinIsTTY: false, stdoutIsTTY: true },
        async () => "  \n",
      ),
    ).rejects.toThrow("Headless input is empty.");
  });
});
