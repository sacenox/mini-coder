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
  editTool,
  executeEdit,
  executeReadImage,
  executeShell,
  shellTool,
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

async function withShellEnv<T>(
  shellPath: string,
  run: () => Promise<T>,
): Promise<T> {
  const previousShell = process.env.SHELL;
  process.env.SHELL = shellPath;
  try {
    return await run();
  } finally {
    if (previousShell === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = previousShell;
    }
  }
}

function hasUnpairedSurrogate(input: string): boolean {
  for (let index = 0; index < input.length; index++) {
    const codeUnit = input.charCodeAt(index);
    const isHighSurrogate = codeUnit >= 0xd800 && codeUnit <= 0xdbff;
    const isLowSurrogate = codeUnit >= 0xdc00 && codeUnit <= 0xdfff;

    if (isHighSurrogate) {
      const nextCodeUnit = input.charCodeAt(index + 1);
      const nextIsLowSurrogate =
        nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff;
      if (!nextIsLowSurrogate) {
        return true;
      }
      index++;
      continue;
    }

    if (isLowSurrogate) {
      return true;
    }
  }

  return false;
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

  test("fails when old text is not found and reports the closest match", () => {
    writeFile("a.txt", 'export function foo() {\n  return "hello";\n}\n');
    const result = executeEdit(
      {
        path: "a.txt",
        oldText: "export function foo() {\n  return 'hello';\n}",
        newText: "export function foo() {\n  return 'goodbye';\n}",
      },
      tmp,
    );

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("Old text not found in a.txt");
    expect(resultText(result)).toContain("Closest matches:");
    expect(resultText(result)).toContain("lines 1-3");
    expect(resultText(result)).toContain('return "hello";');
    // File unchanged
    expect(readFile("a.txt")).toBe(
      'export function foo() {\n  return "hello";\n}\n',
    );
  });

  test("fails when old text matches multiple locations and reports where", () => {
    writeFile(
      "a.txt",
      "const value = 1;\nconst other = 2;\nconst value = 1;\n",
    );
    const result = executeEdit(
      {
        path: "a.txt",
        oldText: "const value = 1;",
        newText: "const value = 3;",
      },
      tmp,
    );

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain(
      "Old text matches multiple locations (2) in a.txt",
    );
    expect(resultText(result)).toContain("Matches:");
    expect(resultText(result)).toContain("line 1");
    expect(resultText(result)).toContain("line 3");
    expect(resultText(result)).toContain("const value = 1;");
    // File unchanged
    expect(readFile("a.txt")).toBe(
      "const value = 1;\nconst other = 2;\nconst value = 1;\n",
    );
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

  test("normalizes multi-line replacements to the file's CRLF line endings", () => {
    writeFile("crlf-multiline.txt", "start\r\nold a\r\nold b\r\nend\r\n");
    const result = executeEdit(
      {
        path: "crlf-multiline.txt",
        oldText: "old a\r\nold b",
        newText: "new a\nnew b",
      },
      tmp,
    );

    expect(result.isError).toBe(false);
    expect(readFile("crlf-multiline.txt")).toBe(
      "start\r\nnew a\r\nnew b\r\nend\r\n",
    );
  });

  test("normalizes multi-line replacements to the file's LF line endings", () => {
    writeFile("lf-multiline.txt", "start\nold a\nold b\nend\n");
    const result = executeEdit(
      {
        path: "lf-multiline.txt",
        oldText: "old a\nold b",
        newText: "new a\r\nnew b",
      },
      tmp,
    );

    expect(result.isError).toBe(false);
    expect(readFile("lf-multiline.txt")).toBe("start\nnew a\nnew b\nend\n");
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

  test("inserts replacement text literally when it contains replacement markers", () => {
    writeFile("literal.txt", "before TARGET after");
    const result = executeEdit(
      {
        path: "literal.txt",
        oldText: "TARGET",
        newText: "$$ $& $` $'",
      },
      tmp,
    );

    expect(result.isError).toBe(false);
    expect(readFile("literal.txt")).toBe("before $$ $& $` $' after");
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
    expect(resultText(result)).toContain("Exit code: 0");
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
    expect(resultText(result)).toContain("Exit code: 42");
  });

  test("runs in the specified cwd", async () => {
    const result = await executeShell({ command: "pwd" }, tmp);
    expect(result.isError).toBe(false);
    expect(resultText(result)).toContain(tmp);
  });

  test("normalizes leading-dash printf format strings", async () => {
    const result = await withShellEnv("/bin/sh", () =>
      executeShell({ command: "printf '--- spec.md ---\\n'" }, tmp),
    );

    expect(result.isError).toBe(false);
    expect(resultText(result)).toContain("Exit code: 0");
    expect(resultText(result)).toContain("--- spec.md ---");
  });

  test("normalizes heredoc pipe trailers back onto the heredoc start line", async () => {
    const result = await withShellEnv("/bin/sh", () =>
      executeShell(
        {
          command: "python3 - <<'PY'\nprint('first')\nPY | sed -n '1p'\n",
        },
        tmp,
      ),
    );

    expect(result.isError).toBe(false);
    expect(resultText(result)).toContain("Exit code: 0");
    expect(resultText(result)).toContain("first");
    expect(resultText(result)).not.toContain("SyntaxError");
  });

  test("normalizes heredoc redirect trailers back onto the heredoc start line", async () => {
    const result = await withShellEnv("/bin/sh", () =>
      executeShell(
        {
          command:
            "cat <<'EOF'\nhello\nEOF > out.txt\n[ -f out.txt ] && cat out.txt\n",
        },
        tmp,
      ),
    );

    expect(result.isError).toBe(false);
    expect(resultText(result)).toContain("Exit code: 0");
    expect(resultText(result)).toContain("hello");
    expect(readFile("out.txt")).toBe("hello\n");
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

  test("truncates huge output even when line count is small", async () => {
    const longLine = "x".repeat(20_000);
    writeFileSync(join(tmp, "huge-lines.txt"), `${longLine}\n${longLine}\n`);

    const result = await executeShell(
      {
        command:
          "bun -e \"process.stdout.write(require('node:fs').readFileSync('huge-lines.txt', 'utf8'))\"",
      },
      tmp,
      {
        maxLines: 100,
        maxBytes: 4_000,
      },
    );

    expect(result.isError).toBe(false);
    const text = resultText(result);
    expect(text).toContain("… truncated");
    expect(text.length).toBeLessThan(40_000);
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

  test("reports progressive output updates while a command runs", async () => {
    const updates: string[] = [];

    const result = await executeShell(
      {
        command: "printf 'first\n'; sleep 0.05; printf 'second\n'",
      },
      tmp,
      {
        onUpdate: (partial) => {
          updates.push(resultText(partial));
        },
      },
    );

    expect(result.isError).toBe(false);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.some((text) => text.includes("first"))).toBe(true);
    expect(updates.at(-1)).toContain("second");
  });

  test("throttles progressive output updates for chatty commands", async () => {
    const updates: string[] = [];

    const result = await executeShell(
      {
        command:
          "i=1; while [ $i -le 20 ]; do printf '%s\\n' \"$i\"; sleep 0.01; i=$((i + 1)); done",
      },
      tmp,
      {
        onUpdate: (partial) => {
          updates.push(resultText(partial));
        },
      },
    );

    expect(result.isError).toBe(false);
    expect(updates.at(-1)).toContain("20");
    expect(updates.length).toBeLessThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// truncateOutput (pure function)
// ---------------------------------------------------------------------------

describe("truncateOutput", () => {
  test("returns input unchanged when within limits", () => {
    const input = "line1\nline2\nline3";
    expect(truncateOutput(input, 10, 1_000)).toBe(input);
  });

  test("truncates keeping head and tail with marker when line count exceeds the limit", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i + 1}`);
    const input = lines.join("\n");
    const result = truncateOutput(input, 20, 10_000);

    expect(result).toContain("line1");
    expect(result).toContain("line100");
    expect(result).toContain("… truncated");
  });

  test("truncates keeping head and tail with marker when byte size exceeds the limit", () => {
    const head = "A".repeat(6_000);
    const tail = "B".repeat(6_000);
    const input = `${head}\n${tail}`;
    const result = truncateOutput(input, 100, 4_000);

    expect(result).toContain("AAAA");
    expect(result).toContain("BBBB");
    expect(result).toContain("… truncated");
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(4_000);
  });

  test("applies line and byte limits in a single truncation pass", () => {
    const lines = Array.from(
      { length: 100 },
      (_, i) => `${i + 1}:${"x".repeat(300)}`,
    );
    const input = lines.join("\n");
    const result = truncateOutput(input, 20, 2_000);

    expect(result).toContain("1:");
    expect(result).toContain("100:");
    expect(result).toContain("… truncated 80 lines …");
    expect(result).not.toContain("… truncated for size …");
    expect(result.match(/… truncated/g) ?? []).toHaveLength(1);
    expect(result.split("\n").length).toBeLessThanOrEqual(21);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(2_000);
  });

  test("preserves surrogate pairs when truncating by UTF-8 byte size", () => {
    const input = `${"🙂".repeat(6)}ABC${"🙃".repeat(6)}`;
    const result = truncateOutput(input, 100, 42);

    expect(result).toContain("… truncated for size …");
    expect(result.startsWith("🙂")).toBe(true);
    expect(result.endsWith("🙃")).toBe(true);
    expect(hasUnpairedSurrogate(result)).toBe(false);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(42);
  });

  test("head and tail do not overlap", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `L${i + 1}`);
    const input = lines.join("\n");
    const result = truncateOutput(input, 20, 10_000);

    // Count total lines (head + marker + tail)
    const resultLines = result.split("\n");
    // Should be ≤ maxLines + 1 (for the marker line)
    expect(resultLines.length).toBeLessThanOrEqual(21);
  });

  test("handles empty input", () => {
    expect(truncateOutput("", 10, 1_000)).toBe("");
  });

  test("handles single-line input", () => {
    expect(truncateOutput("hello", 10, 1_000)).toBe("hello");
  });

  test("handles input at exactly the line and byte limit", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`);
    const input = lines.join("\n");
    expect(truncateOutput(input, 10, Buffer.byteLength(input, "utf8"))).toBe(
      input,
    );
  });
});

// ---------------------------------------------------------------------------
// tool definitions
// ---------------------------------------------------------------------------

describe("tool definitions", () => {
  test("shell description steers toward verifier-aware, focused inspection", () => {
    expect(shellTool.description).toContain("read tests/verifiers/examples");
    expect(shellTool.description).toContain("inspect required outputs");
    expect(shellTool.description).toContain("targeted checks");
  });

  test("edit description emphasizes exact required file content", () => {
    expect(editTool.description).toContain(
      "write the exact final file content the task requires",
    );
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

  test("returns a tool error when reading the image file fails", () => {
    mkdirSync(join(tmp, "broken.png"));
    const result = executeReadImage({ path: "broken.png" }, tmp);

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("Failed to read image");
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
