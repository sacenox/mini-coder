import {
	applyExactTextEdit,
	FileEditError,
	type FileEditErrorCode,
} from "./exact-text.ts";

interface FileEditCliArgs {
	cwd: string;
	path: string;
	oldText: string;
	newText: string;
}

interface FileEditCliIo {
	stdout: (text: string) => void;
	stderr: (text: string) => void;
}

type FileEditCliSuccess = {
	ok: true;
	path: string;
	changed: boolean;
};

type FileEditCliFailure = {
	ok: false;
	code: FileEditErrorCode | "invalid_args";
	message: string;
	path?: string;
};

const HELP = `Usage: mc-edit <path> (--old <text> | --old-file <path>) [--new <text> | --new-file <path>] [--cwd <path>]

Apply one safe exact-text edit to an existing file.
- The expected old text must match exactly once.
- Omit --new / --new-file to delete the matched text.
- Output is a single JSON object on stdout.`;

async function readArgText(
	flag: "--old-file" | "--new-file",
	filePath: string,
): Promise<string> {
	const file = Bun.file(filePath);
	if (!(await file.exists())) {
		throw new FileEditError(
			"file_not_found",
			`${flag} file not found: "${filePath}".`,
		);
	}
	return file.text();
}

async function parseFileEditCliArgs(
	argv: string[],
): Promise<FileEditCliArgs | null> {
	let cwd = process.cwd();
	let path: string | null = null;
	let oldText: string | null = null;
	let oldFilePath: string | null = null;
	let newText: string | null = null;
	let newFilePath: string | null = null;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i] ?? "";
		switch (arg) {
			case "--help":
			case "-h":
				return null;
			case "--cwd":
				cwd = argv[++i] ?? process.cwd();
				break;
			case "--old":
				oldText = argv[++i] ?? "";
				break;
			case "--old-file":
				oldFilePath = argv[++i] ?? null;
				break;
			case "--new":
				newText = argv[++i] ?? "";
				break;
			case "--new-file":
				newFilePath = argv[++i] ?? null;
				break;
			default:
				if (arg.startsWith("-")) {
					throw new Error(`Unknown flag: ${arg}`);
				}
				if (path !== null) {
					throw new Error("Expected exactly one positional <path> argument.");
				}
				path = arg;
		}
	}

	if (path === null) {
		throw new Error("Missing required <path> argument.");
	}
	if ((oldText === null) === (oldFilePath === null)) {
		throw new Error("Provide exactly one of --old or --old-file.");
	}
	if (newText !== null && newFilePath !== null) {
		throw new Error("Provide at most one of --new or --new-file.");
	}

	return {
		cwd,
		path,
		oldText: oldText ?? (await readArgText("--old-file", oldFilePath ?? "")),
		newText:
			newText ??
			(newFilePath ? await readArgText("--new-file", newFilePath) : ""),
	};
}

function writeJson(
	io: FileEditCliIo,
	payload: FileEditCliSuccess | FileEditCliFailure,
) {
	io.stdout(`${JSON.stringify(payload)}\n`);
}

function normalizeCliError(error: unknown): FileEditCliFailure {
	if (error instanceof FileEditError) {
		return {
			ok: false,
			code: error.code,
			message: error.message,
		};
	}
	if (error instanceof Error) {
		return {
			ok: false,
			code: "invalid_args",
			message: error.message,
		};
	}
	return {
		ok: false,
		code: "invalid_args",
		message: "Unknown error.",
	};
}

export async function runFileEditCli(
	argv: string[],
	io: FileEditCliIo = {
		stdout: (text) => process.stdout.write(text),
		stderr: (text) => process.stderr.write(text),
	},
): Promise<number> {
	try {
		const parsed = await parseFileEditCliArgs(argv);
		if (parsed === null) {
			io.stderr(`${HELP}\n`);
			return 0;
		}

		const result = await applyExactTextEdit(parsed);
		writeJson(io, { ok: true, ...result });
		return 0;
	} catch (error) {
		writeJson(io, normalizeCliError(error));
		return 1;
	}
}
