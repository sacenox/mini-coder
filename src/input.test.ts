import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMANDS, parseInput } from "./input.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mc-input-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Command detection
// ---------------------------------------------------------------------------

describe("parseInput — commands", () => {
  test("recognizes each known command", () => {
    for (const cmd of COMMANDS) {
      const result = parseInput(`/${cmd}`);
      expect(result).toEqual({ type: "command", command: cmd, args: "" });
    }
  });
});

// ---------------------------------------------------------------------------
// Skill detection
// ---------------------------------------------------------------------------

describe("parseInput — skills", () => {
  test("/skill:name rest extracts skill and user text", () => {
    expect(parseInput("/skill:code-review check the auth module")).toEqual({
      type: "skill",
      skillName: "code-review",
      userText: "check the auth module",
    });
  });
});

// ---------------------------------------------------------------------------
// Image detection
// ---------------------------------------------------------------------------

describe("parseInput — images", () => {
  test("existing image path with supported extension", () => {
    const img = join(tmp, "screenshot.png");
    writeFileSync(img, "fake png");
    const result = parseInput(img, { supportsImages: true });
    expect(result).toEqual({ type: "image", path: img });
  });

  test("image path when model does not support images is plain text", () => {
    const img = join(tmp, "screenshot.png");
    writeFileSync(img, "fake png");
    const result = parseInput(img, { supportsImages: false });
    expect(result.type).toBe("text");
  });

  test("input with extra text is not an image", () => {
    const img = join(tmp, "screenshot.png");
    writeFileSync(img, "fake png");
    const result = parseInput(`look at ${img}`, { supportsImages: true });
    expect(result.type).toBe("text");
  });

  test("relative image path resolved against cwd", () => {
    const img = join(tmp, "img.png");
    writeFileSync(img, "fake png");
    const result = parseInput("img.png", { supportsImages: true, cwd: tmp });
    expect(result).toEqual({ type: "image", path: img });
  });

  test("image in subdirectory with cwd", () => {
    const sub = join(tmp, "assets");
    mkdirSync(sub);
    writeFileSync(join(sub, "logo.webp"), "fake webp");
    const result = parseInput("assets/logo.webp", {
      supportsImages: true,
      cwd: tmp,
    });
    expect(result).toEqual({
      type: "image",
      path: join(sub, "logo.webp"),
    });
  });
});

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

describe("parseInput — text", () => {
  test("regular message is text", () => {
    expect(parseInput("fix the tests")).toEqual({
      type: "text",
      text: "fix the tests",
    });
  });
});

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

describe("parseInput — priority", () => {
  test("commands take priority over image detection", () => {
    // Even if /model.png existed, /model is a command
    const result = parseInput("/model");
    expect(result.type).toBe("command");
  });

  test("skill takes priority over image detection", () => {
    const result = parseInput("/skill:review");
    expect(result.type).toBe("skill");
  });
});
