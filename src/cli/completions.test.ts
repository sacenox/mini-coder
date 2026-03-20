import { describe, expect, test } from "bun:test";
import { getCommandCompletions } from "./completions.ts";

describe("getCommandCompletions", () => {
  const cwd = process.cwd();

  test("completes partial command name", () => {
    const results = getCommandCompletions("/mod", cwd);
    expect(results).toContain("/model");
    expect(results).toContain("/models");
  });

  test("completes /m to multiple commands", () => {
    const results = getCommandCompletions("/m", cwd);
    expect(results).toContain("/model");
    expect(results).toContain("/models");
    expect(results).toContain("/mcp");
  });

  test("returns empty for unknown command prefix", () => {
    const results = getCommandCompletions("/zzz", cwd);
    expect(results).toEqual([]);
  });

  test("completes /model subcommand", () => {
    const results = getCommandCompletions("/model ", cwd);
    expect(results).toContain("/model effort");
  });

  test("completes /model effort values", () => {
    const results = getCommandCompletions("/model effort l", cwd);
    expect(results).toContain("/model effort low");
  });

  test("completes /reasoning params", () => {
    const results = getCommandCompletions("/reasoning o", cwd);
    expect(results).toContain("/reasoning on");
    expect(results).toContain("/reasoning off");
  });

  test("completes /verbose params", () => {
    const results = getCommandCompletions("/verbose o", cwd);
    expect(results).toContain("/verbose on");
    expect(results).toContain("/verbose off");
  });

  test("completes /mcp subcommands", () => {
    const results = getCommandCompletions("/mcp ", cwd);
    expect(results).toContain("/mcp list");
    expect(results).toContain("/mcp add");
    expect(results).toContain("/mcp remove");
    expect(results).toContain("/mcp rm");
  });

  test("exact match for single-word command", () => {
    const results = getCommandCompletions("/undo", cwd);
    expect(results).toEqual(["/undo"]);
  });

  test("/ alone lists top commands", () => {
    const results = getCommandCompletions("/", cwd);
    expect(results.length).toBe(10);
    expect(results).toContain("/model");
    expect(results).toContain("/verbose");
  });

  test("returns empty for fourth token", () => {
    const results = getCommandCompletions("/model effort low extra", cwd);
    expect(results).toEqual([]);
  });
});
