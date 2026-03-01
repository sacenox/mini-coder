import * as c from "yoctocolors";
import { type CommandContext, handleCommand } from "../cli/commands.ts";
import { readline, type InputResult } from "../cli/input.ts";
import { PREFIX } from "../cli/output.ts";
import type { CoreMessage } from "../llm-api/turn.ts";
import { saveMessages } from "../session/db/index.ts";
import { hasRalphSignal, runShellPassthrough } from "./agent-helpers.ts";
import type { AgentReporter } from "./reporter.ts";
import type { SessionRunner } from "./session-runner.ts";

export interface InputLoopOptions {
	cwd: string;
	reporter: AgentReporter;
	cmdCtx: CommandContext;
	runner: SessionRunner;
	renderStatusBar: () => Promise<void>;
}

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
				}
				continue;
			}

			case "submit": {
				const RALPH_MAX_ITERATIONS = 20;
				let ralphIteration = 1;
				let lastText = await runner.processUserInput(input.text, input.images);

				if (runner.ralphMode) {
					const goal = input.text;
					const goalImages = input.images;
					while (runner.ralphMode) {
						if (hasRalphSignal(lastText)) {
							runner.ralphMode = false;
							reporter.writeText(`${PREFIX.info} ${c.dim("ralph mode off")}`);
							break;
						}
						if (ralphIteration >= RALPH_MAX_ITERATIONS) {
							reporter.writeText(
								`${PREFIX.info} ${c.yellow("ralph")} ${c.dim("— max iterations reached, stopping")}`,
							);
							runner.ralphMode = false;
							break;
						}
						ralphIteration++;
						cmdCtx.startNewSession();
						lastText = await runner.processUserInput(goal, goalImages);
					}
				}
				continue;
			}
		}
	}
}
