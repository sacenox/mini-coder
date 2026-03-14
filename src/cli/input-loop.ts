import * as c from "yoctocolors";
import type { AgentReporter } from "../agent/reporter.ts";
import type { SessionRunner } from "../agent/session-runner.ts";

import { getContextWindow } from "../llm-api/providers.ts";
import type { CoreMessage } from "../llm-api/turn.ts";
import { saveMessages } from "../session/db/index.ts";
import { getGitBranch, runShellPassthrough } from "./cli-helpers.ts";
import { handleCommand } from "./commands.ts";
import { resolveFileRefs } from "./file-refs.ts";
import { type InputResult, readline } from "./input.ts";
import { tildePath } from "./output.ts";

import type { CommandContext } from "./types.ts";

interface InputLoopOptions {
	cwd: string;
	reporter: AgentReporter;
	cmdCtx: CommandContext;
	runner: SessionRunner;
}

export async function runInputLoop(opts: InputLoopOptions): Promise<void> {
	const { cwd, reporter, cmdCtx, runner } = opts;

	while (true) {
		const branch = await getGitBranch(cwd);
		const provider = runner.currentModel.split("/")[0] ?? "";
		const modelShort = runner.currentModel.split("/").slice(1).join("/");
		const cwdDisplay = tildePath(cwd);

		reporter.renderStatusBar({
			model: modelShort,
			provider,
			cwd: cwdDisplay,
			gitBranch: branch,
			sessionId: runner.session.id,
			inputTokens: runner.totalIn,
			outputTokens: runner.totalOut,
			contextTokens: runner.lastContextTokens,
			contextWindow: getContextWindow(runner.currentModel) ?? 0,
			thinkingEffort: runner.currentThinkingEffort,
			activeAgent: cmdCtx.activeAgent,
			showReasoning: runner.showReasoning,
		});

		let input: InputResult;
		try {
			input = await readline({
				cwd,
			});
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
					const thisTurn = runner.turnIndex++;
					const msg: CoreMessage = {
						role: "user",
						content: `Shell output of \`${input.command}\`:\n\`\`\`\n${out}\n\`\`\``,
					};
					runner.session.messages.push(msg);
					saveMessages(runner.session.id, [msg], thisTurn);
					runner.coreHistory.push(msg);
					runner.snapshotStack.push(null);
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
