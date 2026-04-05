import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executeEdit,
  executeReadImage,
  executeShell,
  type ToolExecResult,
  truncateOutput,
} from "./tools.ts";

/** Extract the text string from a text-only ToolExecResult. */
function resultText(r: ToolExecResult): string {
  const block = r.content[0];
  if (!block || block.type !== "text") throw new Error("Expected text content");
  return block.text;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mc-tools-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeFile(name: string, content: string): string {
  const p = join(tmp, name);
  writeFileSync(p, content);
  return p;
}

function readFile(name: string): string {
  return readFileSync(join(tmp, name), "utf-8");
}

// ---------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------

describe("edit", () => {
  test("replaces exact text match", () => {
    writeFile("a.txt", "hello world");
    const result = executeEdit(
      { path: "a.txt", oldText: "hello", newText: "goodbye" },
      tmp,
    );
    expect(result.isError).toBe(false);
    expect(readFile("a.txt")).toBe("goodbye world");
  });

  test("fails when old text is not found", () => {
    writeFile("a.txt", "hello world");
    const result = executeEdit(
      { path: "a.txt", oldText: "missing", newText: "x" },
      tmp,
    );
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("not found");
    // File unchanged
    expect(readFile("a.txt")).toBe("hello world");
  });

  test("fails when old text matches multiple locations", () => {
    writeFile("a.txt", "aaa bbb aaa");
    const result = executeEdit(
      { path: "a.txt", oldText: "aaa", newText: "ccc" },
      tmp,
    );
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("multiple");
    // File unchanged
    expect(readFile("a.txt")).toBe("aaa bbb aaa");
  });

  test("creates new file when oldText is empty", () => {
    const result = executeEdit(
      { path: "new.txt", oldText: "", newText: "brand new content" },
      tmp,
    );
    expect(result.isError).toBe(false);
    expect(readFile("new.txt")).toBe("brand new content");
  });

  test("creates parent directories for new files", () => {
    const result = executeEdit(
      { path: "deep/nested/dir/file.txt", oldText: "", newText: "nested" },
      tmp,
    );
    expect(result.isError).toBe(false);
    expect(readFile("deep/nested/dir/file.txt")).toBe("nested");
  });

  test("fails to create file when it already exists and oldText is empty", () => {
    writeFile("existing.txt", "already here");
    const result = executeEdit(
      { path: "existing.txt", oldText: "", newText: "overwrite" },
      tmp,
    );
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("already exists");
    // File unchanged
    expect(readFile("existing.txt")).toBe("already here");
  });

  test("preserves LF line endings", () => {
    writeFile("lf.txt", "line1\nline2\nline3\n");
    executeEdit({ path: "lf.txt", oldText: "line2", newText: "replaced" }, tmp);
    expect(readFile("lf.txt")).toBe("line1\nreplaced\nline3\n");
  });

  test("preserves CRLF line endings", () => {
    writeFile("crlf.txt", "line1\r\nline2\r\nline3\r\n");
    executeEdit(
      { path: "crlf.txt", oldText: "line2", newText: "replaced" },
      tmp,
    );
    expect(readFile("crlf.txt")).toBe("line1\r\nreplaced\r\nline3\r\n");
  });

  test("handles UTF-8 content", () => {
    writeFile("utf8.txt", "こんにちは世界");
    const result = executeEdit(
      { path: "utf8.txt", oldText: "世界", newText: "🌍" },
      tmp,
    );
    expect(result.isError).toBe(false);
    expect(readFile("utf8.txt")).toBe("こんにちは🌍");
  });

  test("handles multi-line old text", () => {
    writeFile("multi.txt", "function foo() {\n  return 1;\n}\n");
    const result = executeEdit(
      {
        path: "multi.txt",
        oldText: "function foo() {\n  return 1;\n}",
        newText: "function foo() {\n  return 2;\n}",
      },
      tmp,
    );
    expect(result.isError).toBe(false);
    expect(readFile("multi.txt")).toBe("function foo() {\n  return 2;\n}\n");
  });

  test("resolves relative paths against cwd", () => {
    mkdirSync(join(tmp, "sub"), { recursive: true });
    writeFileSync(join(tmp, "sub", "rel.txt"), "original");
    const result = executeEdit(
      { path: "sub/rel.txt", oldText: "original", newText: "modified" },
      tmp,
    );
    expect(result.isError).toBe(false);
    expect(readFileSync(join(tmp, "sub", "rel.txt"), "utf-8")).toBe("modified");
  });

  test("handles absolute paths directly", () => {
    const absPath = writeFile("abs.txt", "content");
    const result = executeEdit(
      { path: absPath, oldText: "content", newText: "new content" },
      tmp,
    );
    expect(result.isError).toBe(false);
    expect(readFile("abs.txt")).toBe("new content");
  });

  test("fails when file does not exist for non-empty oldText", () => {
    const result = executeEdit(
      { path: "nonexistent.txt", oldText: "something", newText: "else" },
      tmp,
    );
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

describe("shell", () => {
  test("returns stdout from a command", async () => {
    const result = await executeShell({ command: "echo hello" }, tmp);
    expect(result.isError).toBe(false);
    expect(resultText(result)).toContain("hello");
  });

  test("returns stderr from a command", async () => {
    const result = await executeShell({ command: "echo err >&2" }, tmp);
    expect(result.isError).toBe(false);
    expect(resultText(result)).toContain("err");
  });

  test("passes through exit code", async () => {
    const result = await executeShell({ command: "exit 42" }, tmp);
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("exit code 42");
  });

  test("runs in the specified cwd", async () => {
    const result = await executeShell({ command: "pwd" }, tmp);
    expect(result.isError).toBe(false);
    expect(resultText(result)).toContain(tmp);
  });

  test("truncates large output", async () => {
    // Generate 2000 lines, which should exceed the default truncation limit
    const result = await executeShell({ command: "seq 1 2000" }, tmp, {
      maxLines: 100,
    });
    expect(result.isError).toBe(false);
    const text = resultText(result);
    expect(text).toContain("… truncated");
    // Should contain head lines (near the start)
    expect(text).toContain("1\n");
    // Should contain tail lines (near the end)
    expect(text).toContain("2000");
  });

  test("does not truncate output within the limit", async () => {
    const result = await executeShell({ command: "seq 1 10" }, tmp, {
      maxLines: 100,
    });
    expect(result.isError).toBe(false);
    expect(resultText(result)).not.toContain("truncated");
  });

  test("supports abort signal", async () => {
    const controller = new AbortController();
    // Abort immediately
    controller.abort();
    const result = await executeShell({ command: "sleep 10" }, tmp, {
      signal: controller.signal,
    });
    expect(result.isError).toBe(true);
  });

  test("combines stdout and stderr in output", async () => {
    const result = await executeShell(
      { command: "echo out && echo err >&2" },
      tmp,
    );
    const text = resultText(result);
    expect(text).toContain("out");
    expect(text).toContain("err");
  });
});

// ---------------------------------------------------------------------------
// truncateOutput (pure function)
// ---------------------------------------------------------------------------

describe("truncateOutput", () => {
  test("returns input unchanged when within limit", () => {
    const input = "line1\nline2\nline3";
    expect(truncateOutput(input, 10)).toBe(input);
  });

  test("truncates keeping head and tail with marker", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i + 1}`);
    const input = lines.join("\n");
    const result = truncateOutput(input, 20);

    expect(result).toContain("line1");
    expect(result).toContain("line100");
    expect(result).toContain("… truncated");
  });

  test("head and tail do not overlap", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `L${i + 1}`);
    const input = lines.join("\n");
    const result = truncateOutput(input, 20);

    // Count total lines (head + marker + tail)
    const resultLines = result.split("\n");
    // Should be ≤ maxLines + 1 (for the marker line)
    expect(resultLines.length).toBeLessThanOrEqual(21);
  });

  test("handles empty input", () => {
    expect(truncateOutput("", 10)).toBe("");
  });

  test("handles single-line input", () => {
    expect(truncateOutput("hello", 10)).toBe("hello");
  });

  test("handles input at exactly the limit", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`);
    const input = lines.join("\n");
    expect(truncateOutput(input, 10)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// readImage
// ---------------------------------------------------------------------------

describe("readImage", () => {
  test("reads a PNG file and returns base64 with correct mime type", () => {
    const data = Buffer.from("fake png data");
    writeFileSync(join(tmp, "test.png"), data);
    const result = executeReadImage({ path: "test.png" }, tmp);
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("image");
    if (result.content[0]!.type === "image") {
      expect(result.content[0]!.mimeType).toBe("image/png");
      expect(result.content[0]!.data).toBe(data.toString("base64"));
    }
  });

  test("detects JPEG mime type from .jpeg extension", () => {
    writeFileSync(join(tmp, "photo.jpeg"), "jpeg data");
    const result = executeReadImage({ path: "photo.jpeg" }, tmp);
    expect(result.isError).toBe(false);
    if (result.content[0]!.type === "image") {
      expect(result.content[0]!.mimeType).toBe("image/jpeg");
    }
  });

  test("detects JPEG mime type from .jpg extension", () => {
    writeFileSync(join(tmp, "photo.jpg"), "jpg data");
    const result = executeReadImage({ path: "photo.jpg" }, tmp);
    expect(result.isError).toBe(false);
    if (result.content[0]!.type === "image") {
      expect(result.content[0]!.mimeType).toBe("image/jpeg");
    }
  });

  test("detects GIF mime type", () => {
    writeFileSync(join(tmp, "anim.gif"), "gif data");
    const result = executeReadImage({ path: "anim.gif" }, tmp);
    expect(result.isError).toBe(false);
    if (result.content[0]!.type === "image") {
      expect(result.content[0]!.mimeType).toBe("image/gif");
    }
  });

  test("detects WebP mime type", () => {
    writeFileSync(join(tmp, "image.webp"), "webp data");
    const result = executeReadImage({ path: "image.webp" }, tmp);
    expect(result.isError).toBe(false);
    if (result.content[0]!.type === "image") {
      expect(result.content[0]!.mimeType).toBe("image/webp");
    }
  });

  test("rejects unsupported image format", () => {
    writeFileSync(join(tmp, "vector.svg"), "<svg></svg>");
    const result = executeReadImage({ path: "vector.svg" }, tmp);
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("Unsupported");
  });

  test("handles missing file", () => {
    const result = executeReadImage({ path: "nonexistent.png" }, tmp);
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("not found");
  });

  test("resolves relative paths against cwd", () => {
    mkdirSync(join(tmp, "sub"), { recursive: true });
    writeFileSync(join(tmp, "sub", "img.png"), "png in sub");
    const result = executeReadImage({ path: "sub/img.png" }, tmp);
    expect(result.isError).toBe(false);
    expect(result.content[0]!.type).toBe("image");
  });

  test("resolves absolute paths directly", () => {
    const absPath = join(tmp, "abs.png");
    writeFileSync(absPath, "absolute png");
    const result = executeReadImage({ path: absPath }, tmp);
    expect(result.isError).toBe(false);
    expect(result.content[0]!.type).toBe("image");
  });
});
