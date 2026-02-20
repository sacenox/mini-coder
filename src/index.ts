#!/usr/bin/env bun
import * as c from "yoctocolors";
import { runAgent } from "./agent/agent.ts";
import {
	registerTerminalCleanup,
	renderBanner,
	renderError,
	writeln,
} from "./cli/output.ts";
import { autoDiscoverModel } from "./llm-api/providers.ts";
import { getPreferredModel } from "./session/db.ts";
import { getMostRecentSession, printSessionList } from "./session/manager.ts";

// Register terminal cleanup handlers as early as possible so the cursor is
// always restored even if the process crashes or is killed.
registerTerminalCleanup();

// ─── CLI argument parsing ─────────────────────────────────────────────────────

interface CliArgs {
	model: string | null;
	sessionId: string | null;
	listSessions: boolean;
	resumeLast: boolean;
	prompt: string | null;
	cwd: string;
	help: boolean;
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

	if (!args.prompt) {
		// Only show banner for interactive sessions, not piped/one-shot
		renderBanner(model, args.cwd);
	}

	try {
		const agentOpts: Parameters<typeof runAgent>[0] = { model, cwd: args.cwd };
		if (sessionId) agentOpts.sessionId = sessionId;
		if (args.prompt) agentOpts.initialPrompt = args.prompt;
		await runAgent(agentOpts);
	} catch (err) {
		renderError(err);
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
