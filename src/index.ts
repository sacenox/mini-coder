#!/usr/bin/env bun
import { writeSync } from "node:fs";

import * as c from "yoctocolors";
import { initAgent } from "./agent/agent.ts";
import { loadAgents } from "./cli/agents.ts";
import { parseArgs, printHelp } from "./cli/args.ts";
import { bootstrapGlobalDefaults } from "./cli/bootstrap.ts";
import { initErrorLog } from "./cli/error-log.ts";
import { resolveFileRefs } from "./cli/file-refs.ts";
import { HeadlessReporter } from "./cli/headless-reporter.ts";
import { runInputLoop } from "./cli/input-loop.ts";
import {
	registerTerminalCleanup,
	renderBanner,
	renderError,
	writeln,
} from "./cli/output.ts";
import { CliReporter } from "./cli/output-reporter.ts";
import { initApiLog } from "./llm-api/api-log.ts";
import {
	initModelInfoCache,
	refreshModelInfoInBackground,
} from "./llm-api/model-info.ts";
import { autoDiscoverModel } from "./llm-api/providers.ts";

import {
	getPreferredContextPruningMode,
	getPreferredModel,
	getPreferredShowReasoning,
	getPreferredThinkingEffort,
	getPreferredToolResultPayloadCapBytes,
} from "./session/db/index.ts";
import { getMostRecentSession, printSessionList } from "./session/manager.ts";

// Register terminal cleanup handlers as early as possible so the cursor is
// always restored even if the process crashes or is killed.
registerTerminalCleanup();
initErrorLog();
initApiLog();
initModelInfoCache();
void refreshModelInfoInBackground().catch(() => {});

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const args = parseArgs(argv);

	if (args.help) {
		printHelp();
		process.exit(0);
	}

	if (args.listSessions) {
		printSessionList();
		process.exit(0);
	}

	// Determine session
	let sessionId: string | undefined;
	if (args.resumeLast) {
		const last = getMostRecentSession();
		if (last) {
			sessionId = last.id;
		} else {
			writeln(c.dim("No previous session found, starting fresh."));
		}
	} else if (args.sessionId) {
		sessionId = args.sessionId;
	}

	// Determine model: CLI flag > persisted user preference > auto-discover
	const model = args.model ?? getPreferredModel() ?? autoDiscoverModel();

	if (!args.subagent) {
		bootstrapGlobalDefaults();
	}

	if (args.subagent) {
		// Headless mode: no banner, no interactive loop, single prompt then exit
		const parentCwd = args.cwd;
		let agentSystemPrompt: string | undefined;
		let modelOverride = model;

		if (args.agentName) {
			const agents = loadAgents(args.cwd);
			const agentConfig = agents.get(args.agentName);
			if (!agentConfig) {
				renderError(new Error(`Agent "${args.agentName}" not found`), "agent");
				process.exit(1);
			}
			agentSystemPrompt = agentConfig.systemPrompt;
			if (agentConfig.model) modelOverride = agentConfig.model;
		}

		try {
			const { runner } = await initAgent({
				model: modelOverride,
				cwd: parentCwd,
				initialThinkingEffort: getPreferredThinkingEffort(),
				initialShowReasoning: getPreferredShowReasoning(),
				initialPruningMode: getPreferredContextPruningMode(),
				initialToolResultPayloadCapBytes:
					getPreferredToolResultPayloadCapBytes(),
				reporter: new HeadlessReporter(),
				headless: true,
				...(agentSystemPrompt ? { agentSystemPrompt } : {}),
			});

			const { text: resolvedText, images: refImages } = await resolveFileRefs(
				args.prompt ?? "",
				parentCwd,
			);
			const result = await runner.processUserInput(resolvedText, refImages);
			const summary = {
				result,
				inputTokens: runner.totalIn,
				outputTokens: runner.totalOut,
			};

			if (args.outputFd !== null && summary) {
				const json = `${JSON.stringify(summary)}\n`;
				writeSync(args.outputFd, Buffer.from(json));
			}
		} catch (err) {
			if (args.outputFd !== null) {
				const json = `${JSON.stringify({ error: String(err) })}\n`;
				writeSync(args.outputFd, Buffer.from(json));
			}
			process.exit(1);
		}
		return;
	}

	if (!args.prompt) {
		// Only show banner for interactive sessions, not piped/one-shot
		renderBanner(model, args.cwd);
	}

	try {
		const agentOpts: Parameters<typeof initAgent>[0] = {
			model,
			cwd: args.cwd,
			initialThinkingEffort: getPreferredThinkingEffort(),
			initialShowReasoning: getPreferredShowReasoning(),
			initialPruningMode: getPreferredContextPruningMode(),
			initialToolResultPayloadCapBytes: getPreferredToolResultPayloadCapBytes(),
			reporter: new CliReporter(),
		};
		if (sessionId) agentOpts.sessionId = sessionId;

		const { runner, cmdCtx } = await initAgent(agentOpts);

		if (args.prompt) {
			const { text: resolvedText, images: refImages } = await resolveFileRefs(
				args.prompt,
				args.cwd,
			);
			await runner.processUserInput(resolvedText, refImages);
		}

		await runInputLoop({
			cwd: args.cwd,
			reporter: agentOpts.reporter,
			cmdCtx,
			runner,
		});
	} catch (err) {
		renderError(err, "agent");
		process.exit(1);
	}
}

main().catch((err) => {
	renderError(err, "main");
	process.exit(1);
});
