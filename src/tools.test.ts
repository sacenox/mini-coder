import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@mariozechner/pi-ai";
import {
  createTodoWriteToolHandler,
  editToolHandler,
  executeEdit,
  executeGrep,
  executeRead,
  executeReadImage,
  executeShell,
  executeTodoRead,
  executeTodoWrite,
  getTodoItems,
  grepToolHandler,
  parseGrepResult,
  parseReadResult,
  readImageToolHandler,
  readToolHandler,
  shellToolHandler,
  type ToolExecResult,
} from "./tools.ts";

/** Extract the combined text string from a text-only ToolExecResult. */
function resultText(r: ToolExecResult): string {
  const blocks = r.content.filter(
    (
      block,
    ): block is Extract<ToolExecResult["content"][number], { type: "text" }> =>
      block.type === "text",
  );
  if (blocks.length === 0) throw new Error("Expected text content");
  return blocks.map((block) => block.text).join("\n\n");
}

function todoSnapshot(r: ToolExecResult) {
  return JSON.parse(resultText(r)) as {
    todos: Array<{
      content: string;
      status: "pending" | "in_progress" | "completed";
    }>;
  };
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

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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
    expect(resultText(result)).toContain("Old text not found");
    expect(resultText(result)).toContain("line");
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
    expect(resultText(result)).toContain("Old text matches multiple locations");
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

  test("preserves CRLF line endings", () => {
    writeFile("crlf.txt", "line1\r\nline2\r\nline3\r\n");
    executeEdit(
      { path: "crlf.txt", oldText: "line2", newText: "replaced" },
      tmp,
    );
    expect(readFile("crlf.txt")).toBe("line1\r\nreplaced\r\nline3\r\n");
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
});

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

describe("read", () => {
  test("returns a bounded line slice with a continuation hint", async () => {
    writeFile("a.txt", "line 1\nline 2\nline 3\n");

    const result = await executeRead({ path: "a.txt", limit: 2 }, tmp);

    expect(result.isError).toBe(false);
    const parsed = parseReadResult(resultText(result));
    expect(parsed.body).toBe("line 1\nline 2\n");
    expect(parsed.continuation).toEqual({ offset: 2, limit: 2 });
  });

  test("supports offset windows", async () => {
    writeFile("a.txt", "line 1\nline 2\nline 3\n");

    const result = await executeRead(
      { path: "a.txt", offset: 1, limit: 1 },
      tmp,
    );

    expect(result.isError).toBe(false);
    const parsed = parseReadResult(resultText(result));
    expect(parsed.body).toBe("line 2\n");
    expect(parsed.continuation).toEqual({ offset: 2, limit: 1 });
  });

  test("streams progressive prefix updates while reading larger slices", async () => {
    writeFile(
      "stream.txt",
      `${Array.from({ length: 120 }, (_, index) => `line ${index + 1}`).join(
        "\n",
      )}\n`,
    );
    const updates: string[] = [];

    const result = await executeRead({ path: "stream.txt", limit: 100 }, tmp, {
      onUpdate: (partial) => {
        updates.push(resultText(partial));
      },
    });

    expect(result.isError).toBe(false);
    expect(updates.length).toBeGreaterThan(1);
    expect(updates[0]).toContain("line 1");
    expect(updates[0]).not.toContain("line 100");
    expect(updates.at(-1)).not.toContain("line 100");
    expect((updates.at(-1) ?? "").length).toBeGreaterThan(
      updates[0]?.length ?? 0,
    );
    for (let index = 1; index < updates.length; index += 1) {
      expect(updates[index]?.startsWith(updates[index - 1] ?? "")).toBe(true);
    }
  });

  test("keeps literal continuation-looking text in the file body", async () => {
    writeFile(
      "hint.txt",
      "alpha\n\n[use offset=99 limit=10 to continue]\nomega\n",
    );

    const result = await executeRead({ path: "hint.txt", limit: 3 }, tmp);
    const textBlocks = result.content.filter(
      (
        block,
      ): block is Extract<
        ToolExecResult["content"][number],
        { type: "text" }
      > => block.type === "text",
    );

    expect(result.isError).toBe(false);
    expect(textBlocks).toEqual([
      {
        type: "text",
        text: "alpha\n\n[use offset=99 limit=10 to continue]\n",
      },
      {
        type: "text",
        text: "[use offset=3 limit=3 to continue]",
      },
    ]);
  });

  test("rejects offsets beyond the available line range", async () => {
    writeFile("a.txt", "line 1\nline 2\n");

    const result = await executeRead(
      { path: "a.txt", offset: 2, limit: 1 },
      tmp,
    );

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("out of range");
  });
});

// ---------------------------------------------------------------------------
// grep
// ---------------------------------------------------------------------------

describe("grep", () => {
  test("returns structured grouped matches with context lines", async () => {
    writeFile("a.ts", "before\nneedle one\nafter\n");
    writeFile("b.ts", "alpha\nNEEDLE two\nomega\n");

    const result = await executeGrep(
      {
        pattern: "needle",
        glob: "*.ts",
        ignoreCase: true,
        context: 1,
      },
      tmp,
    );

    expect(result.isError).toBe(false);
    const parsed = parseGrepResult(resultText(result));
    if (!parsed) {
      throw new Error("Expected a structured grep result");
    }

    expect(parsed.truncated).toBe(false);
    expect(parsed.files.map((file) => file.path)).toEqual(["a.ts", "b.ts"]);
    expect(parsed.files[0]?.lines).toEqual([
      { kind: "context", lineNumber: 1, text: "before\n" },
      { kind: "match", lineNumber: 2, text: "needle one\n" },
      { kind: "context", lineNumber: 3, text: "after\n" },
    ]);
    expect(parsed.files[1]?.lines[1]).toEqual({
      kind: "match",
      lineNumber: 2,
      text: "NEEDLE two\n",
    });
  });

  test("returns an empty structured result when nothing matches", async () => {
    writeFile("a.ts", "before\nafter\n");

    const result = await executeGrep({ pattern: "needle", glob: "*.ts" }, tmp);

    expect(result.isError).toBe(false);
    expect(parseGrepResult(resultText(result))).toEqual({
      limit: 50,
      truncated: false,
      files: [],
    });
  });

  test("marks results as truncated when the match limit is reached", async () => {
    writeFile("a.ts", "needle one\nneedle two\nneedle three\n");

    const result = await executeGrep(
      { pattern: "needle", path: "a.ts", limit: 2 },
      tmp,
    );

    expect(result.isError).toBe(false);
    const parsed = parseGrepResult(resultText(result));
    if (!parsed) {
      throw new Error("Expected a structured grep result");
    }

    expect(parsed.truncated).toBe(true);
    expect(parsed.hint).toContain("Results truncated");
    expect(
      parsed.files[0]?.lines.filter((line) => line.kind === "match"),
    ).toHaveLength(2);
  });

  test("does not include leading context for later excluded matches after hitting the limit", async () => {
    writeFile(
      "a.ts",
      "needle one\nafter one\nspacer\nbefore two\nneedle two\nafter two\n",
    );

    const result = await executeGrep(
      { pattern: "needle", path: "a.ts", context: 1, limit: 1 },
      tmp,
    );

    expect(result.isError).toBe(false);
    const parsed = parseGrepResult(resultText(result));
    if (!parsed) {
      throw new Error("Expected a structured grep result");
    }

    expect(parsed.truncated).toBe(true);
    expect(parsed.files[0]?.lines).toEqual([
      { kind: "match", lineNumber: 1, text: "needle one\n" },
      { kind: "context", lineNumber: 2, text: "after one\n" },
    ]);
  });

  test("does not include context from later excluded matches in other files after hitting the limit", async () => {
    writeFile("aa.txt", "needle\n");
    writeFile("ab.txt", "before\nneedle\n");

    const result = await executeGrep(
      { pattern: "needle", glob: "*.txt", context: 1, limit: 1 },
      tmp,
    );

    expect(result.isError).toBe(false);
    const parsed = parseGrepResult(resultText(result));
    if (!parsed) {
      throw new Error("Expected a structured grep result");
    }

    expect(parsed.truncated).toBe(true);
    expect(parsed.files).toEqual([
      {
        path: "aa.txt",
        lines: [{ kind: "match", lineNumber: 1, text: "needle\n" }],
      },
    ]);
  });

  test("counts multiple submatches on the same line toward the match limit", async () => {
    writeFile("a.ts", "needle needle\nafter\n");

    const result = await executeGrep(
      { pattern: "needle", path: "a.ts", context: 1, limit: 1 },
      tmp,
    );

    expect(result.isError).toBe(false);
    const parsed = parseGrepResult(resultText(result));
    if (!parsed) {
      throw new Error("Expected a structured grep result");
    }

    expect(parsed.truncated).toBe(true);
    expect(parsed.files[0]?.lines).toEqual([
      { kind: "match", lineNumber: 1, text: "needle needle\n" },
      { kind: "context", lineNumber: 2, text: "after\n" },
    ]);
  });

  test("returns a tool error instead of throwing when rg is unavailable", async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = tmp;

    try {
      const result = await executeGrep({ pattern: "needle", path: "." }, tmp);

      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain(
        'Executable not found in $PATH: "rg"',
      );
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

describe("shell", () => {
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

  test("supports abort signal", async () => {
    const controller = new AbortController();
    // Abort immediately
    controller.abort();
    const result = await executeShell({ command: "sleep 10" }, tmp, {
      signal: controller.signal,
    });
    expect(result.isError).toBe(true);
  });

  test("abort signal kills spawned child processes that keep the shell pipes open", async () => {
    const controller = new AbortController();
    const pidFile = join(tmp, "child.pid");
    const command = `sleep 30 & echo $! > '${pidFile}' && wait`;
    const resultPromise = executeShell({ command }, tmp, {
      signal: controller.signal,
    });

    let childPid: number | null = null;
    try {
      await waitFor(() => existsSync(pidFile));
      childPid = Number(readFileSync(pidFile, "utf-8").trim());
      const startedChildPid = childPid;

      controller.abort();

      const result = await Promise.race([
        resultPromise,
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error("Shell command did not abort promptly"));
          }, 1_000);
        }),
      ]);

      expect(result.isError).toBe(true);
      await waitFor(() => !isProcessAlive(startedChildPid), 1_000);
    } finally {
      if (childPid !== null && isProcessAlive(childPid)) {
        process.kill(childPid, "SIGKILL");
      }
    }
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

describe("built-in tool handlers", () => {
  test("edit handler validates required arguments before execution", () => {
    const args: Record<string, unknown> = { oldText: "", newText: "x" };

    expect(() => editToolHandler(args, tmp)).toThrow(
      /Validation failed for tool "edit"/,
    );
  });

  test("shell handler validates required arguments before execution", () => {
    const args: Record<string, unknown> = {};

    expect(() => shellToolHandler(args, tmp)).toThrow(
      /Validation failed for tool "shell"/,
    );
  });

  test("todoWrite handler validates argument shape before execution", () => {
    const handler = createTodoWriteToolHandler([]);
    const args: Record<string, unknown> = {};

    expect(() => handler(args, tmp)).toThrow(
      /Validation failed for tool "todoWrite"/,
    );
  });

  test("read handler validates required arguments before execution", () => {
    const args: Record<string, unknown> = {};

    expect(() => readToolHandler(args, tmp)).toThrow(
      /Validation failed for tool "read"/,
    );
  });

  test("grep handler validates required arguments before execution", () => {
    const args: Record<string, unknown> = {};

    expect(() => grepToolHandler(args, tmp)).toThrow(
      /Validation failed for tool "grep"/,
    );
  });

  test("readImage handler validates required arguments before execution", () => {
    const args: Record<string, unknown> = {};

    expect(() => readImageToolHandler(args, tmp)).toThrow(
      /Validation failed for tool "readImage"/,
    );
  });
});

// ---------------------------------------------------------------------------
// truncateOutput (pure function)
// ---------------------------------------------------------------------------

describe("truncateOutput", () => {});

// ---------------------------------------------------------------------------
// todo tools
// ---------------------------------------------------------------------------

describe("todo tools", () => {
  test("todoWrite creates a new todo list snapshot", () => {
    const result = executeTodoWrite(
      {
        todos: [
          { content: "Inspect the current command surface", status: "pending" },
          { content: "Implement todo tooling", status: "in_progress" },
        ],
      },
      [],
    );

    expect(result.isError).toBe(false);
    expect(todoSnapshot(result)).toEqual({
      todos: [
        { content: "Inspect the current command surface", status: "pending" },
        { content: "Implement todo tooling", status: "in_progress" },
      ],
    });
  });

  test("todoWrite updates existing items incrementally and preserves order", () => {
    const messages: Message[] = [
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "todoWrite",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              todos: [
                {
                  content: "Inspect the current command surface",
                  status: "completed",
                },
                { content: "Implement todo tooling", status: "pending" },
              ],
            }),
          },
        ],
        isError: false,
        timestamp: 1,
      },
    ];

    const result = executeTodoWrite(
      {
        todos: [
          { content: "Implement todo tooling", status: "in_progress" },
          { content: "Add UI /todo command", status: "pending" },
        ],
      },
      messages,
    );

    expect(result.isError).toBe(false);
    expect(todoSnapshot(result)).toEqual({
      todos: [
        {
          content: "Inspect the current command surface",
          status: "completed",
        },
        { content: "Implement todo tooling", status: "in_progress" },
        { content: "Add UI /todo command", status: "pending" },
      ],
    });
  });

  test("todoRead returns the latest successful persisted snapshot and ignores later errors", () => {
    const messages: Message[] = [
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "todoWrite",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              todos: [
                {
                  content: "Inspect the current command surface",
                  status: "completed",
                },
                { content: "Implement todo tooling", status: "pending" },
              ],
            }),
          },
        ],
        isError: false,
        timestamp: 1,
      },
      {
        role: "toolResult",
        toolCallId: "call-2",
        toolName: "todoWrite",
        content: [{ type: "text", text: "Todo content cannot be empty" }],
        isError: true,
        timestamp: 2,
      },
    ];

    expect(getTodoItems(messages)).toEqual([
      { content: "Inspect the current command surface", status: "completed" },
      { content: "Implement todo tooling", status: "pending" },
    ]);
    expect(todoSnapshot(executeTodoRead(messages))).toEqual({
      todos: [
        {
          content: "Inspect the current command surface",
          status: "completed",
        },
        { content: "Implement todo tooling", status: "pending" },
      ],
    });
  });

  test("todoWrite rejects empty content", () => {
    const result = executeTodoWrite(
      {
        todos: [{ content: "   ", status: "pending" }],
      },
      [],
    );

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("cannot be empty");
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
});
