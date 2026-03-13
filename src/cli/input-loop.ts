import * as c from "yoctocolors";
import {
	buildRalphIterationPrompt,
	hasRalphSignal,
} from "../agent/agent-helpers.ts";
import type { AgentReporter } from "../agent/reporter.ts";
import type { SessionRunner } from "../agent/session-runner.ts";
import { getContextWindow } from "../llm-api/providers.ts";
import type { CoreMessage } from "../llm-api/turn.ts";
import { saveMessages } from "../session/db/index.ts";
import { getGitBranch, runShellPassthrough } from "./cli-helpers.ts";
import { handleCommand } from "./commands.ts";
import { resolveFileRefs } from "./file-refs.ts";
import { type InputResult, readline } from "./input.ts";
import { PREFIX, tildePath } from "./output.ts";
import type { CommandContext } from "./types.ts";

interface InputLoopOptions {
	cwd: string;
	reporter: AgentReporter;
	cmdCtx: CommandContext;
	runner: SessionRunner;
}

const RALPH_MAX_ITERATIONS = 20;

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
			ralphMode: runner.ralphMode,
			thinkingEffort: runner.currentThinkingEffort,
			activeAgent: cmdCtx.activeAgent,
			showReasoning: runner.showReasoning,
		});

		let input: InputResult;
		try {
			input = await readline({
				cwd,
				planMode: runner.planMode,
				ralphMode: runner.ralphMode,
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

				if (!runner.ralphMode) {
					try {
						await runner.processUserInput(resolvedText, allImages);
					} catch {
						// Error already rendered by stream-render; continue the loop.
					}
					continue;
				}

				// True ralph loop: each iteration is a fresh subprocess.
				// State persists via the filesystem and git history — NOT the context window.
				if (allImages.length > 0) {
					reporter.writeText(
						`${PREFIX.info} ${c.yellow("ralph")} ${c.dim("— image attachments are not supported and will be ignored")}`,
					);
				}
				const ralphGoal = buildRalphIterationPrompt(resolvedText);

				for (
					let iteration = 1;
					iteration <= RALPH_MAX_ITERATIONS;
					iteration++
				) {
					reporter.writeText(
						`${PREFIX.info} ${c.magenta("ralph")} ${c.dim(`— iteration ${String(iteration)}`)}`,
					);

					let result: string;
					try {
						cmdCtx.startSpinner("ralph");
						const output = await cmdCtx.runSubagent(ralphGoal);
						result = output.result;
						cmdCtx.stopSpinner();
					} catch (err) {
						cmdCtx.stopSpinner();
						reporter.writeText(
							`${PREFIX.info} ${c.yellow("ralph")} ${c.dim(`— iteration ${String(iteration)} failed: ${String(err)}`)}`,
						);
						runner.ralphMode = false;
						break;
					}

					if (hasRalphSignal(result)) {
						reporter.writeText(
							`${PREFIX.info} ${c.dim("ralph — task complete")}`,
						);
						runner.ralphMode = false;
						break;
					}

					if (iteration === RALPH_MAX_ITERATIONS) {
						reporter.writeText(
							`${PREFIX.info} ${c.yellow("ralph")} ${c.dim("— max iterations reached, stopping")}`,
						);
						runner.ralphMode = false;
					}
				}
				continue;
			}
		}
	}
}
