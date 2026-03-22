import { afterEach, describe, expect, test } from "bun:test";
import {
  captureStdout,
  getCapturedStdout,
  restoreStdout,
  stripAnsi,
} from "./test-helpers.ts";
import {
  buildToolCallLine,
  renderToolCall,
  renderToolResult,
} from "./tool-render.ts";

afterEach(() => {
  restoreStdout();
});

describe("buildToolCallLine", () => {
  test("formats shell calls without truncation", () => {
    const cmd = "echo x".repeat(30);
    const line = buildToolCallLine("shell", { command: cmd });
    expect(line).toContain("$");
    expect(line).toContain(cmd);
  });

  test("formats empty shell start events as a generic shell label", () => {
    const line = buildToolCallLine("shell", {});
    expect(line).toContain("$");
    expect(line).toContain("shell");
  });

  test("classifies sed -n as read (read-only)", () => {
    const line = stripAnsi(
      buildToolCallLine("shell", { command: "sed -n 1,200p file.ts" }),
    );
    expect(line).toContain("←");
    expect(line).not.toContain("✎");
  });

  test("classifies sed -i as write (in-place)", () => {
    const line = stripAnsi(
      buildToolCallLine("shell", { command: "sed -i s/foo/bar/g file.ts" }),
    );
    expect(line).toContain("✎");
  });

  test("classifies plain sed as read", () => {
    const line = stripAnsi(
      buildToolCallLine("shell", { command: "sed s/foo/bar/ file.ts" }),
    );
    expect(line).toContain("←");
    expect(line).not.toContain("✎");
  });

  test("formats readSkill calls with the requested skill name", () => {
    const line = buildToolCallLine("readSkill", { name: "deploy" });
    expect(line).toContain("read skill");
    expect(line).toContain("deploy");
  });
});

describe("renderToolCall", () => {
  test("truncates multiline shell commands when not verbose", () => {
    captureStdout();
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
    renderToolCall("shell", { command: lines.join("\n") });
    const out = stripAnsi(getCapturedStdout());
    expect(out).toContain("line 0");
    expect(out).toContain("line 2");
    expect(out).toContain("… +5 lines");
    expect(out).toContain("line 8");
    expect(out).toContain("line 9");
    expect(out).not.toContain("line 5");
  });

  test("shows full command when verbose", () => {
    captureStdout();
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
    renderToolCall(
      "shell",
      { command: lines.join("\n") },
      { verboseOutput: true },
    );
    const out = stripAnsi(getCapturedStdout());
    for (let i = 0; i < 10; i++) {
      expect(out).toContain(`line ${i}`);
    }
    expect(out).not.toContain("… +");
  });

  test("does not truncate short commands", () => {
    captureStdout();
    renderToolCall("shell", { command: "ls -la" });
    const out = stripAnsi(getCapturedStdout());
    expect(out).toContain("ls -la");
    expect(out).not.toContain("…");
  });
});

describe("renderToolResult", () => {
  test("shows stderr preview for failed commands", () => {
    captureStdout();

    renderToolResult(
      "shell",
      {
        stdout: "",
        stderr: "boom",
        exitCode: 1,
        success: false,
        timedOut: false,
      },
      false,
    );

    const plain = stripAnsi(getCapturedStdout());
    expect(plain).toContain("error exit 1 · stderr 1L");
    expect(plain).toContain("boom");
  });

  test("shows stdout previews for successful multi-line commands", () => {
    captureStdout();

    renderToolResult(
      "shell",
      {
        stdout: "hello\nworld",
        stderr: "",
        exitCode: 0,
        success: true,
        timedOut: false,
      },
      false,
    );

    const plain = stripAnsi(getCapturedStdout());
    expect(plain).toContain("done exit 0 · stdout 2L");
    expect(plain).toContain("stdout (2 lines)");
    expect(plain).toContain("hello");
    expect(plain).toContain("world");
  });

  test("truncates shell previews by keeping head and tail when verbose is off", () => {
    captureStdout();
    const stdoutLines = Array.from(
      { length: 30 },
      (_, i) => `line-${i + 1}`,
    ).join("\n");

    renderToolResult(
      "shell",
      {
        stdout: stdoutLines,
        stderr: "",
        exitCode: 0,
        success: true,
        timedOut: false,
      },
      false,
    );

    const plain = stripAnsi(getCapturedStdout());
    expect(plain).toContain("line-1");
    expect(plain).toContain("line-10");
    expect(plain).toContain("… +10 lines");
    expect(plain).toContain("line-21");
    expect(plain).toContain("line-30");
  });

  test("shows full shell previews when verbose is on", () => {
    captureStdout();
    const stdoutLines = Array.from(
      { length: 8 },
      (_, i) => `line-${i + 1}`,
    ).join("\n");

    renderToolResult(
      "shell",
      {
        stdout: stdoutLines,
        stderr: "",
        exitCode: 0,
        success: true,
        timedOut: false,
      },
      false,
      { verboseOutput: true },
    );

    const plain = stripAnsi(getCapturedStdout());
    expect(plain).toContain("line-1");
    expect(plain).toContain("line-8");
    expect(plain).not.toContain("… +");
  });

  test("renders compact listSkills previews", () => {
    captureStdout();

    renderToolResult(
      "listSkills",
      {
        skills: [
          { name: "deploy", description: "Deploy safely", source: "local" },
          { name: "release", description: "Ship releases", source: "global" },
        ],
      },
      false,
    );

    const plain = stripAnsi(getCapturedStdout());
    expect(plain).toContain("deploy  ·  local  ·  Deploy safely");
    expect(plain).toContain("release  ·  global  ·  Ship releases");
  });
});
