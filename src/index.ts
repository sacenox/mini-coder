#!/usr/bin/env bun
import { existsSync, mkdirSync, writeFileSync, writeSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import * as c from "yoctocolors";
import { runAgent } from "./agent/agent.ts";
import { loadAgents } from "./cli/agents.ts";
import { initErrorLog } from "./cli/error-log.ts";
import { HeadlessReporter } from "./cli/headless-reporter.ts";
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
	getPreferredModel,
	getPreferredThinkingEffort,
} from "./session/db/index.ts";
import { getMostRecentSession, printSessionList } from "./session/manager.ts";
import {
	applyParentChanges,
	createWorktree,
	initializeWorktree,
	isGitRepo,
	removeWorktree,
} from "./tools/worktree.ts";

// Register terminal cleanup handlers as early as possible so the cursor is
// always restored even if the process crashes or is killed.
registerTerminalCleanup();
initErrorLog();
initApiLog();
initModelInfoCache();
void refreshModelInfoInBackground().catch(() => {});

// ─── CLI argument parsing ─────────────────────────────────────────────────────

interface CliArgs {
	model: string | null;
	sessionId: string | null;
	listSessions: boolean;
	resumeLast: boolean;
	prompt: string | null;
	cwd: string;
	help: boolean;
	subagent: boolean;
	agentName: string | null;
	outputFd: number | null;
	worktreeBranch: string | null;
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		model: null,
		sessionId: null,
		listSessions: false,
		resumeLast: false,
		prompt: null,
		cwd: process.cwd(),
		help: false,
		subagent: false,
		agentName: null,
		outputFd: null,
		worktreeBranch: null,
	};

	const positional: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i] ?? "";
		switch (arg) {
			case "--model":
			case "-m":
				args.model = argv[++i] ?? null;
				break;
			case "--resume":
			case "-r":
				args.sessionId = argv[++i] ?? null;
				break;
			case "--continue":
			case "-c":
				args.resumeLast = true;
				break;
			case "--list":
			case "-l":
				args.listSessions = true;
				break;
			case "--cwd":
				args.cwd = argv[++i] ?? process.cwd();
				break;
			case "--help":
			case "-h":
				args.help = true;
				break;
			case "--subagent":
				args.subagent = true;
				break;
			case "--agent":
				args.agentName = argv[++i] ?? null;
				break;
			case "--output-fd": {
				const fd = parseInt(argv[++i] ?? "", 10);
				if (!Number.isNaN(fd)) args.outputFd = fd;
				break;
			}
			case "--worktree-branch":
				args.worktreeBranch = argv[++i] ?? null;
				break;
			default:
				if (!arg.startsWith("-")) positional.push(arg);
		}
	}

	if (positional.length > 0) {
		args.prompt = positional.join(" ");
	}

	return args;
}

function printHelp(): void {
	writeln(`${c.bold("mini-coder")} — a small, fast CLI coding agent\n`);
	writeln(`${c.bold("Usage:")}  mc [options] [prompt]\n`);
	writeln(`${c.bold("Options:")}`);
	const opts = [
		["-m, --model <id>", "Model to use (e.g. zen/claude-sonnet-4-6)"],
		["-c, --continue", "Continue the most recent session"],
		["-r, --resume <id>", "Resume a specific session by ID"],
		["-l, --list", "List recent sessions"],
		["--cwd <path>", "Set working directory (default: current dir)"],
		["-h, --help", "Show this help"],
	];
	for (const [flag, desc] of opts) {
		writeln(`  ${c.cyan((flag ?? "").padEnd(22))} ${c.dim(desc ?? "")}`);
	}
	writeln(`\n${c.bold("Provider env vars:")}`);
	const envs = [
		["OPENCODE_API_KEY", "OpenCode Zen (recommended)"],
		["ANTHROPIC_API_KEY", "Anthropic direct"],
		["OPENAI_API_KEY", "OpenAI direct"],
		["GOOGLE_API_KEY", "Google Gemini direct"],
		["OLLAMA_BASE_URL", "Ollama base URL (default: http://localhost:11434)"],
	];
	for (const [env, desc] of envs) {
		writeln(`  ${c.yellow((env ?? "").padEnd(22))} ${c.dim(desc ?? "")}`);
	}
	writeln(`\n${c.bold("Examples:")}`);
	writeln(`  mc                           ${c.dim("# interactive session")}`);
	writeln(
		`  mc "explain this codebase"   ${c.dim("# one-shot prompt then interactive")}`,
	);
	writeln(`  mc -c                        ${c.dim("# continue last session")}`);
	writeln(
		`  mc -m ollama/llama3.2        ${c.dim("# use local Ollama model")}`,
	);
	writeln(`  mc -l                        ${c.dim("# list sessions")}`);
}

// ─── Bootstrap global defaults ────────────────────────────────────────────────

const REVIEW_COMMAND_CONTENT = `---
description: Review recent changes for correctness, code quality, and performance
---
You are a code reviewer. Review recent changes and provide actionable feedback.

$ARGUMENTS

Perform a sensible code review:
- Correctness: Are the changes in alignment with the goal?
- Code quality: Is there duplicate, dead, or bad code patterns introduced?
- Is the code performant?
- Never flag style choices as bugs, don't be a zealot.
- Never flag false positives, check before raising an issue.

Output a small summary with only the issues found. If nothing is wrong, say so.
`;

function bootstrapGlobalDefaults(): void {
	const commandsDir = join(homedir(), ".agents", "commands");
	const reviewPath = join(commandsDir, "review.md");
	if (!existsSync(reviewPath)) {
		mkdirSync(commandsDir, { recursive: true });
		writeFileSync(reviewPath, REVIEW_COMMAND_CONTENT, "utf-8");
		writeln(
			`${c.green("✓")} created ${c.dim("~/.agents/commands/review.md")} ${c.dim("(edit it to customise your reviews)")}`,
		);
	}
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

		// Worktree lifecycle: create before run, remove dir after (keep branch for parent to merge).
		let worktreePath: string | undefined;
		// Use the branch name the parent assigned (so it can clean up on interrupt).
		let worktreeBranch: string | undefined = args.worktreeBranch ?? undefined;
		let runCwd = parentCwd;

		if (await isGitRepo(parentCwd)) {
			if (!worktreeBranch) {
				// Fallback: generate our own if the parent didn't pass one (shouldn't happen in practice).
				worktreeBranch = `mc-sub-${crypto.randomUUID().slice(0, 8)}`;
			}
			worktreePath = join(tmpdir(), worktreeBranch);
			try {
				await createWorktree(parentCwd, worktreeBranch, worktreePath);
				await initializeWorktree(parentCwd, worktreePath);
				await applyParentChanges(parentCwd, worktreePath);
				runCwd = worktreePath;
			} catch {
				// Worktree creation failed — fall back to running in the original cwd.
				worktreeBranch = undefined;
				worktreePath = undefined;
			}
		}

		// SIGTERM handler: clean up worktree directory only; leave branch for parent to discard.
		process.on("SIGTERM", () => {
			if (worktreePath) {
				Bun.spawnSync(["git", "worktree", "remove", "--force", worktreePath], {
					cwd: parentCwd,
				});
			}
			process.exit(1);
		});

		const cleanupWorktree = async (): Promise<void> => {
			if (worktreePath) {
				await removeWorktree(parentCwd, worktreePath).catch(() => {});
				worktreePath = undefined;
			}
		};

		try {
			const summary = await runAgent({
				model: modelOverride,
				cwd: runCwd,
				initialThinkingEffort: getPreferredThinkingEffort(),
				reporter: new HeadlessReporter(),
				initialPrompt: args.prompt ?? "",
				headless: true,
				...(agentSystemPrompt ? { agentSystemPrompt } : {}),
			});

			await cleanupWorktree();

			if (args.outputFd !== null && summary) {
				const payload = worktreeBranch
					? { ...summary, worktreeBranch }
					: summary;
				const json = `${JSON.stringify(payload)}\n`;
				writeSync(args.outputFd, Buffer.from(json));
			}
		} catch (err) {
			await cleanupWorktree();
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
		const agentOpts: Parameters<typeof runAgent>[0] = {
			model,
			cwd: args.cwd,
			initialThinkingEffort: getPreferredThinkingEffort(),
			reporter: new CliReporter(),
		};
		if (sessionId) agentOpts.sessionId = sessionId;
		if (args.prompt) agentOpts.initialPrompt = args.prompt;
		await runAgent(agentOpts);
	} catch (err) {
		renderError(err, "agent");
		process.exit(1);
	}
}

main().catch((err) => {
	renderError(err, "main");
	process.exit(1);
});
