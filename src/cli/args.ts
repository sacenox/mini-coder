import * as c from "yoctocolors";
import { writeln } from "./output.ts";

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
}

export function parseArgs(argv: string[]): CliArgs {
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
				const fd = Number.parseInt(argv[++i] ?? "", 10);
				if (!Number.isNaN(fd)) args.outputFd = fd;
				break;
			}
			default:
				if (!arg.startsWith("-")) positional.push(arg);
		}
	}

	if (positional.length > 0) {
		args.prompt = positional.join(" ");
	}

	return args;
}

export function printHelp(): void {
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
		["GEMINI_API_KEY", "Gemini direct (alias for GOOGLE_API_KEY)"],
		["EXA_API_KEY", "Enables webSearch and webContent tools"],
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
