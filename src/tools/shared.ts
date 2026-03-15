import { resolvePath } from "../internal/file-edit/path.ts";

export { resolvePath };

export async function resolveExistingFile(
	cwdInput: string | undefined,
	pathInput: string,
) {
	const { cwd, filePath, relPath } = resolvePath(cwdInput, pathInput);
	const file = Bun.file(filePath);
	if (!(await file.exists())) {
		throw new Error(
			`File not found: "${relPath}". To create a new file use the \`create\` tool.`,
		);
	}
	return { file, filePath, relPath, cwd };
}

interface ParsedAnchor {
	line: number;
	hash: string;
}

export function parseAnchor(value: string, name = "anchor"): ParsedAnchor {
	const normalized = value.trim().endsWith("|")
		? value.trim().slice(0, -1)
		: value;
	const match = /^\s*(\d+):([0-9a-fA-F]{2})\s*$/.exec(normalized);
	if (!match) {
		throw new Error(
			`Invalid ${name}. Expected format: "line:hh" (e.g. "11:a3").`,
		);
	}

	const line = Number(match[1]);
	if (!Number.isInteger(line) || line < 1) {
		throw new Error(`Invalid ${name} line number.`);
	}

	const hash = match[2];
	if (!hash) {
		throw new Error(
			`Invalid ${name}. Expected format: "line:hh" (e.g. "11:a3").`,
		);
	}

	return { line, hash: hash.toLowerCase() };
}

export async function applyFileEdit(
	snapshotCallback: ((filePath: string) => Promise<void>) | undefined,
	filePath: string,
	relPath: string,
	original: string,
	updated: string,
) {
	await snapshotCallback?.(filePath);
	await Bun.write(filePath, updated);

	// diff deferred to finalizeWriteResult (hook path) or stripWriteResultMeta
	// (no-hook path) to avoid computing it twice on every write in repos with hooks.
	return {
		path: relPath,
		_filePath: filePath,
		_before: original,
		_updated: updated,
	};
}
