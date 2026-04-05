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

  test("unknown /foo is plain text", () => {
    expect(parseInput("/foo")).toEqual({ type: "text", text: "/foo" });
  });

  test("/ alone is plain text", () => {
    expect(parseInput("/")).toEqual({ type: "text", text: "/" });
  });

  test("space after slash is plain text", () => {
    expect(parseInput("/ model")).toEqual({ type: "text", text: "/ model" });
  });

  test("command with trailing whitespace still matches", () => {
    const result = parseInput("/model  ");
    expect(result).toEqual({ type: "command", command: "model", args: "" });
  });

  test("command is case-sensitive (uppercase is text)", () => {
    expect(parseInput("/Model")).toEqual({ type: "text", text: "/Model" });
  });
});

// ---------------------------------------------------------------------------
// Skill detection
// ---------------------------------------------------------------------------

describe("parseInput — skills", () => {
  test("/skill:name extracts skill with no user text", () => {
    expect(parseInput("/skill:review")).toEqual({
      type: "skill",
      skillName: "review",
      userText: "",
    });
  });

  test("/skill:name rest extracts skill and user text", () => {
    expect(parseInput("/skill:code-review check the auth module")).toEqual({
      type: "skill",
      skillName: "code-review",
      userText: "check the auth module",
    });
  });

  test("/skill:name with trailing space has empty user text", () => {
    expect(parseInput("/skill:review ")).toEqual({
      type: "skill",
      skillName: "review",
      userText: "",
    });
  });

  test("/skill: with no name is plain text", () => {
    expect(parseInput("/skill:")).toEqual({ type: "text", text: "/skill:" });
  });

  test("/skill without colon is plain text (not a known command)", () => {
    expect(parseInput("/skill")).toEqual({ type: "text", text: "/skill" });
  });

  test("skill name can contain hyphens and underscores", () => {
    expect(parseInput("/skill:my_cool-skill do stuff")).toEqual({
      type: "skill",
      skillName: "my_cool-skill",
      userText: "do stuff",
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

  test("supports all image extensions", () => {
    for (const ext of [".png", ".jpg", ".jpeg", ".gif", ".webp"]) {
      const img = join(tmp, `test${ext}`);
      writeFileSync(img, "fake");
      const result = parseInput(img, { supportsImages: true });
      expect(result.type).toBe("image");
    }
  });

  test("non-existent image path is plain text", () => {
    const img = join(tmp, "missing.png");
    const result = parseInput(img, { supportsImages: true });
    expect(result.type).toBe("text");
  });

  test("image path when model does not support images is plain text", () => {
    const img = join(tmp, "screenshot.png");
    writeFileSync(img, "fake png");
    const result = parseInput(img, { supportsImages: false });
    expect(result.type).toBe("text");
  });

  test("image path with supportsImages undefined is plain text", () => {
    const img = join(tmp, "screenshot.png");
    writeFileSync(img, "fake png");
    const result = parseInput(img);
    expect(result.type).toBe("text");
  });

  test("non-image extension is plain text even if file exists", () => {
    const file = join(tmp, "readme.txt");
    writeFileSync(file, "hello");
    const result = parseInput(file, { supportsImages: true });
    expect(result.type).toBe("text");
  });

  test("input with extra text is not an image", () => {
    const img = join(tmp, "screenshot.png");
    writeFileSync(img, "fake png");
    const result = parseInput(`look at ${img}`, { supportsImages: true });
    expect(result.type).toBe("text");
  });

  test("trimmed whitespace still detects image", () => {
    const img = join(tmp, "photo.jpg");
    writeFileSync(img, "fake jpg");
    const result = parseInput(`  ${img}  `, { supportsImages: true });
    expect(result).toEqual({ type: "image", path: img });
  });

  test("relative image path resolved against cwd", () => {
    const img = join(tmp, "img.png");
    writeFileSync(img, "fake png");
    const result = parseInput("img.png", { supportsImages: true, cwd: tmp });
    expect(result).toEqual({ type: "image", path: img });
  });

  test("relative image path without cwd checks as-is", () => {
    // Relative path that doesn't exist from process.cwd
    const result = parseInput("nonexistent-dir/img.png", {
      supportsImages: true,
    });
    expect(result.type).toBe("text");
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

  test("uppercase extension is detected", () => {
    const img = join(tmp, "PHOTO.PNG");
    writeFileSync(img, "fake png");
    const result = parseInput(img, { supportsImages: true });
    expect(result).toEqual({ type: "image", path: img });
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

  test("empty string is text", () => {
    expect(parseInput("")).toEqual({ type: "text", text: "" });
  });

  test("whitespace-only is text", () => {
    expect(parseInput("   ")).toEqual({ type: "text", text: "" });
  });

  test("message starting with slash-like but not command", () => {
    expect(parseInput("/usr/bin/node")).toEqual({
      type: "text",
      text: "/usr/bin/node",
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
