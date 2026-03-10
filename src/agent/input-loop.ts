import * as c from "yoctocolors";
import { type CommandContext, handleCommand } from "../cli/commands.ts";
import { type InputResult, readline } from "../cli/input.ts";
import { PREFIX } from "../cli/output.ts";
import type { CoreMessage } from "../llm-api/turn.ts";
import { saveMessages } from "../session/db/index.ts";
import {
	buildRalphIterationPrompt,
	hasRalphSignal,
	runShellPassthrough,
} from "./agent-helpers.ts";
import type { AgentReporter } from "./reporter.ts";
import type { SessionRunner } from "./session-runner.ts";

interface InputLoopOptions {
	cwd: string;
	reporter: AgentReporter;
	cmdCtx: CommandContext;
	runner: SessionRunner;
	renderStatusBar: () => Promise<void>;
}

const RALPH_MAX_ITERATIONS = 20;

export async function runInputLoop(opts: InputLoopOptions): Promise<void> {
	const { cwd, reporter, cmdCtx, runner, renderStatusBar } = opts;

	while (true) {
		await renderStatusBar();

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
					await runner.processUserInput(result.text);
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
				if (!runner.ralphMode) {
					await runner.processUserInput(input.text, input.images);
					continue;
				}

				// True ralph loop: each iteration is a fresh subprocess.
				// State persists via the filesystem and git history — NOT the context window.
				if (input.images && input.images.length > 0) {
					reporter.writeText(
						`${PREFIX.info} ${c.yellow("ralph")} ${c.dim("— image attachments are not supported and will be ignored")}`,
					);
				}
				const ralphGoal = buildRalphIterationPrompt(input.text);

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
						const output = await cmdCtx.runSubagent(ralphGoal);
						result = output.result;
					} catch (err) {
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
