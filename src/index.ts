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
	CliReporter,
	G,
	RenderedError,
	registerTerminalCleanup,
	renderBanner,
	renderError,
	renderUserMessage,
	writeln,
} from "./cli/output.ts";
import { resolvePromptInput } from "./cli/stdin-prompt.ts";
import { writeJsonLine } from "./cli/structured-output.ts";
import { terminal } from "./cli/terminal-io.ts";
import { initApiLog } from "./llm-api/api-log.ts";
import {
	initModelInfoCache,
	refreshModelInfoInBackground,
} from "./llm-api/model-info.ts";
import { autoDiscoverModel } from "./llm-api/providers.ts";

import {
	getPreferredContextPruningMode,
	getPreferredGoogleCachedContent,
	getPreferredModel,
	getPreferredOpenAIPromptCacheRetention,
	getPreferredPromptCachingEnabled,
	getPreferredShowReasoning,
	getPreferredThinkingEffort,
	getPreferredToolResultPayloadCapBytes,
	getPreferredVerboseOutput,
	pruneOldData,
} from "./session/db/index.ts";
import { getMostRecentSession, printSessionList } from "./session/manager.ts";

// Register terminal cleanup handlers as early as possible so the cursor is
// always restored even if the process crashes or is killed.
registerTerminalCleanup();
initErrorLog();
initApiLog();
initModelInfoCache();
pruneOldData();
void refreshModelInfoInBackground().catch(() => {});

type AgentInitOptions = Parameters<typeof initAgent>[0];

function buildAgentOptions(opts: {
	model: string;
	cwd: string;
	reporter: AgentInitOptions["reporter"];
	sessionId?: string | undefined;
	headless?: boolean;
	agentSystemPrompt?: string | undefined;
}): AgentInitOptions {
	return {
		model: opts.model,
		cwd: opts.cwd,
		initialThinkingEffort: getPreferredThinkingEffort(),
		initialShowReasoning: getPreferredShowReasoning(),
		initialVerboseOutput: getPreferredVerboseOutput(),
		initialPruningMode: getPreferredContextPruningMode(),
		initialToolResultPayloadCapBytes: getPreferredToolResultPayloadCapBytes(),
		initialPromptCachingEnabled: getPreferredPromptCachingEnabled(),
		initialOpenAIPromptCacheRetention: getPreferredOpenAIPromptCacheRetention(),
		initialGoogleCachedContent: getPreferredGoogleCachedContent(),
		reporter: opts.reporter,
		...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
		...(opts.headless ? { headless: true } : {}),
		...(opts.agentSystemPrompt
			? { agentSystemPrompt: opts.agentSystemPrompt }
			: {}),
	};
}

function writeStructuredResult(outputFd: number, payload: unknown): void {
	writeJsonLine((text) => {
		writeSync(outputFd, Buffer.from(text));
	}, payload);
}

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

	const prompt = await resolvePromptInput(args.prompt);
	if (!prompt && !terminal.isTTY) {
		renderError(
			new Error(
				"No prompt provided. Pass a prompt argument or pipe text on stdin.",
			),
			"input",
		);
		process.exit(1);
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
			const { runner } = await initAgent(
				buildAgentOptions({
					model: modelOverride,
					cwd: parentCwd,
					reporter: new HeadlessReporter(),
					headless: true,
					agentSystemPrompt,
				}),
			);

			const { text: resolvedText, images: refImages } = await resolveFileRefs(
				prompt ?? "",
				parentCwd,
			);
			const result = await runner.processUserInput(resolvedText, refImages);
			const status = runner.getStatusInfo();
			const summary = {
				result,
				inputTokens: status.totalIn,
				outputTokens: status.totalOut,
			};

			if (args.outputFd !== null) {
				writeStructuredResult(args.outputFd, summary);
			}
		} catch (err) {
			if (args.outputFd !== null) {
				writeStructuredResult(args.outputFd, { error: String(err) });
			}
			process.exit(1);
		}
		return;
	}

	if (!prompt) {
		// Only show banner for interactive sessions, not piped/one-shot
		renderBanner(model, args.cwd);
	}

	try {
		const agentOpts = buildAgentOptions({
			model,
			cwd: args.cwd,
			reporter: new CliReporter(),
			sessionId,
		});

		const { runner, cmdCtx } = await initAgent(agentOpts);

		if (prompt) {
			renderUserMessage(prompt);
			const { text: resolvedText, images: refImages } = await resolveFileRefs(
				prompt,
				args.cwd,
			);
			await runner.processUserInput(resolvedText, refImages);
			const { totalIn, totalOut } = runner.getStatusInfo();
			writeln(
				`${G.info} ${c.dim(`${totalIn.toLocaleString()} in / ${totalOut.toLocaleString()} out tokens`)}`,
			);
			return;
		}

		await runInputLoop({
			cwd: args.cwd,
			reporter: agentOpts.reporter,
			cmdCtx,
			runner,
		});
	} catch (err) {
		if (!(err instanceof RenderedError)) {
			renderError(err, "agent");
		}
		process.exit(1);
	}
}

main().catch((err) => {
	if (!(err instanceof RenderedError)) {
		renderError(err, "main");
	}
	process.exit(1);
});
