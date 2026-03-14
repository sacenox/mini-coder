import * as c from "yoctocolors";
import type { AgentReporter } from "../agent/reporter.ts";
import type { SessionRunner } from "../agent/session-runner.ts";

import { getContextWindow } from "../llm-api/providers.ts";
import { getGitBranch, runShellPassthrough } from "./cli-helpers.ts";
import { handleCommand } from "./commands.ts";
import { resolveFileRefs } from "./file-refs.ts";
import { type InputResult, readline } from "./input.ts";
import { tildePath } from "./output.ts";
import { buildStatusBarSignature } from "./status-bar.ts";

import type { CommandContext } from "./types.ts";

interface InputLoopOptions {
	cwd: string;
	reporter: AgentReporter;
	cmdCtx: CommandContext;
	runner: SessionRunner;
}

export async function runInputLoop(opts: InputLoopOptions): Promise<void> {
	const { cwd, reporter, cmdCtx, runner } = opts;

	let lastStatusSignature: string | null = null;

	while (true) {
		const branch = await getGitBranch(cwd);
		const status = runner.getStatusInfo();
		const provider = status.model.split("/")[0] ?? "";
		const modelShort = status.model.split("/").slice(1).join("/");
		const cwdDisplay = tildePath(cwd);
		const contextWindow = getContextWindow(status.model);
		const statusData = {
			model: modelShort,
			provider,
			cwd: cwdDisplay,
			gitBranch: branch,
			sessionId: status.sessionId,
			inputTokens: status.totalIn,
			outputTokens: status.totalOut,
			contextTokens: status.lastContextTokens,
			contextWindow,
			thinkingEffort: status.thinkingEffort,
			activeAgent: cmdCtx.activeAgent,
			showReasoning: status.showReasoning,
		};
		const statusSignature = buildStatusBarSignature(statusData);
		if (statusSignature !== lastStatusSignature) {
			reporter.renderStatusBar(statusData);
			lastStatusSignature = statusSignature;
		}

		let input: InputResult;
		try {
			input = await readline({ cwd });
		} catch {
			break;
		}

		switch (input.type) {
			case "eof":
				reporter.writeText(c.dim("Goodbye."));
				return;

			case "interrupt":
				continue;

			case "command": {
				const result = await handleCommand(input.command, input.args, cmdCtx);
				if (result.type === "exit") {
					reporter.writeText(c.dim("Goodbye."));
					return;
				}
				if (result.type === "inject-user-message") {
					const { text: resolvedText, images: refImages } =
						await resolveFileRefs(result.text, cwd);
					try {
						await runner.processUserInput(resolvedText, refImages);
					} catch {
						// Error already rendered by stream-render; continue the loop.
					}
				}
				continue;
			}

			case "shell": {
				const out = await runShellPassthrough(input.command, cwd, reporter);
				if (out) {
					runner.addShellContext(input.command, out);
				}
				continue;
			}

			case "submit": {
				const { text: resolvedText, images: refImages } = await resolveFileRefs(
					input.text,
					cwd,
				);
				const allImages = [...(input.images || []), ...refImages];
				try {
					await runner.processUserInput(resolvedText, allImages);
				} catch {
					// Error already rendered by stream-render; continue the loop.
				}
				continue;
			}
		}
	}
}
