import { afterEach, describe, expect, test } from "bun:test";
import { buildStatusBarSignature, renderStatusBar } from "./status-bar.ts";
import { terminal } from "./terminal-io.ts";
import { withTerminalColumns } from "./test-helpers.ts";

let stdout = "";
const originalStdoutWrite = terminal.stdoutWrite.bind(terminal);

function stripAnsi(s: string): string {
	const esc = String.fromCharCode(0x1b);
	return s.replace(new RegExp(`${esc}\\[[0-9;]*m`, "g"), "");
}

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
				model: "gpt-5.3-codex",
				provider: "zen",
				cwd: "~/src/mini-coder",
				gitBranch: "main",
				sessionId: "1234567890",
				inputTokens: 1200,
				outputTokens: 3400,
				contextTokens: 8000,
				contextWindow: 128000,
				thinkingEffort: "medium",
				activeAgent: "general",
				showReasoning: true,
			});
		});

		const line = stripAnsi(stdout).trim();
		expect(line).toContain("gpt-5.3-codex");
		expect(line).toContain("#12345678");
		expect(line).toContain("@general");
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
				model: "gpt-5.3-codex",
				provider: "openai",
				cwd: "~/src/mini-coder",
				gitBranch: "feature/super-long-branch-name",
				sessionId: "abcdef123456",
				inputTokens: 12345,
				outputTokens: 9876,
				contextTokens: 72000,
				contextWindow: 128000,
				thinkingEffort: "xhigh",
				activeAgent: "writer",
				showReasoning: true,
			});
		});

		const line = stripAnsi(stdout).trim();
		expect(line).toContain("gpt-5.3-codex");
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
				model: "llama3.2",
				provider: "ollama",
				cwd: "~/src/mini-coder",
				gitBranch: null,
				sessionId: "001122334455",
				inputTokens: 0,
				outputTokens: 0,
				contextTokens: 2048,
				contextWindow: null,
				thinkingEffort: null,
				activeAgent: null,
				showReasoning: false,
			});
		});

		const line = stripAnsi(stdout).trim();
		expect(line).toContain("ctx 2.0k");
		expect(line).not.toContain("ctx 2.0k/");
	});

	test("buildStatusBarSignature is stable and reflects changed fields", () => {
		const base = {
			model: "gpt-5.3-codex",
			provider: "zen",
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
