import {
  type FileEditCliFailure,
  type StructuredOutputWriter,
  writeFileEditResult,
} from "../../cli/structured-output.ts";
import { applyExactTextEdit, FileEditError } from "./exact-text.ts";

interface FileEditCliArgs {
  cwd: string;
  path: string;
  oldText: string;
  newText: string;
}

const HELP = `Usage: mc-edit <path> (--old <text> | --old-file <path>) [--new <text> | --new-file <path>] [--cwd <path>]

Apply one safe exact-text edit to an existing file.
- The expected old text must match exactly once.
- Omit --new / --new-file to delete the matched text.
- Success output is human-oriented: plain unified diff first, metadata second.`;

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

function buildCliFailure(
  code: FileEditCliFailure["code"],
  message: string,
  path?: string,
): FileEditCliFailure {
  return {
    ok: false,
    code,
    message,
    ...(path ? { path } : {}),
  };
}

function normalizeCliError(error: unknown, path?: string): FileEditCliFailure {
  if (error instanceof FileEditError) {
    return buildCliFailure(error.code, error.message, path);
  }
  if (error instanceof Error) {
    return buildCliFailure("invalid_args", error.message, path);
  }
  return buildCliFailure("invalid_args", "Unknown error.", path);
}

export async function runFileEditCli(
  argv: string[],
  io: StructuredOutputWriter = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
): Promise<number> {
  let parsed: FileEditCliArgs | null = null;

  try {
    parsed = await parseFileEditCliArgs(argv);
    if (parsed === null) {
      io.stderr(`${HELP}\n`);
      return 0;
    }

    const result = await applyExactTextEdit(parsed);
    writeFileEditResult(io, { ok: true, ...result });
    return 0;
  } catch (error) {
    writeFileEditResult(io, normalizeCliError(error, parsed?.path));
    return 1;
  }
}
