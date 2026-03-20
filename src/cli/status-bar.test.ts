import { afterEach, describe, expect, test } from "bun:test";
import { buildStatusBarSignature, renderStatusBar } from "./status-bar.ts";
import { terminal } from "./terminal-io.ts";
import { stripAnsi, withTerminalColumns } from "./test-helpers.ts";

let stdout = "";
const originalStdoutWrite = terminal.stdoutWrite.bind(terminal);

afterEach(() => {
  stdout = "";
  terminal.stdoutWrite = originalStdoutWrite;
});

describe("renderStatusBar", () => {
  test("renders concise segments in stable order", async () => {
    terminal.stdoutWrite = (text: string) => {
      stdout += text;
    };

    await withTerminalColumns(200, () => {
      renderStatusBar({
        model: "zen/gpt-5.3-codex",
        cwd: "~/src/mini-coder",
        gitBranch: "main",
        sessionId: "1234567890",
        inputTokens: 1200,
        outputTokens: 3400,
        contextTokens: 8000,
        contextWindow: 128000,
        thinkingEffort: "medium",
        showReasoning: true,
      });
    });

    const line = stripAnsi(stdout).trim();
    expect(line).toContain("zen/gpt-5.3-codex");
    expect(line).toContain("#12345678");
    expect(line).toContain("tok 1.2k/3.4k");
    expect(line).toContain("ctx 8.0k/128.0k");
    expect(line).toContain("~/src/mini-coder");
    expect(line).not.toContain("reasoning");
  });

  test("drops low-priority segments on narrow terminals", async () => {
    terminal.stdoutWrite = (text: string) => {
      stdout += text;
    };

    await withTerminalColumns(42, () => {
      renderStatusBar({
        model: "zen/gpt-5.3-codex",
        cwd: "~/src/mini-coder",
        gitBranch: "feature/super-long-branch-name",
        sessionId: "abcdef123456",
        inputTokens: 12345,
        outputTokens: 9876,
        contextTokens: 72000,
        contextWindow: 128000,
        thinkingEffort: "xhigh",
        showReasoning: true,
      });
    });

    const line = stripAnsi(stdout).trim();
    expect(line).toContain("zen/gpt-5.3-codex");
    expect(line).toContain("#abcdef12");
    expect(line).not.toContain("~/src/");
    expect(line).not.toContain("ctx 72.0k");
  });

  test("renders context usage without window percentage", async () => {
    terminal.stdoutWrite = (text: string) => {
      stdout += text;
    };

    await withTerminalColumns(120, () => {
      renderStatusBar({
        model: "ollama/llama3.2",
        cwd: "~/src/mini-coder",
        gitBranch: null,
        sessionId: "001122334455",
        inputTokens: 0,
        outputTokens: 0,
        contextTokens: 2048,
        contextWindow: null,
        thinkingEffort: null,
        showReasoning: false,
      });
    });

    const line = stripAnsi(stdout).trim();
    expect(line).toContain("ctx 2.0k");
    expect(line).not.toContain("ctx 2.0k/");
  });

  test("buildStatusBarSignature is stable and reflects changed fields", () => {
    const base = {
      model: "zen/gpt-5.3-codex",
      cwd: "~/src/mini-coder",
      gitBranch: "main",
      sessionId: "1234567890",
      inputTokens: 1,
      outputTokens: 2,
      contextTokens: 3,
      contextWindow: 100,
      thinkingEffort: "medium",
      activeAgent: null,
      showReasoning: false,
    } as const;

    expect(buildStatusBarSignature(base)).toBe(buildStatusBarSignature(base));
    expect(
      buildStatusBarSignature({
        ...base,
        outputTokens: 9,
      }),
    ).not.toBe(buildStatusBarSignature(base));
  });
});
