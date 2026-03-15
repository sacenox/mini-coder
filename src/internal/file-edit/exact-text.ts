import { resolvePath } from "./path.ts";

export type FileEditErrorCode =
	| "empty_old_text"
	| "file_not_found"
	| "target_not_found"
	| "target_not_unique";

export class FileEditError extends Error {
	constructor(
		readonly code: FileEditErrorCode,
		message: string,
	) {
		super(message);
		this.name = "FileEditError";
	}
}

interface PlannedExactTextEdit {
	updated: string;
	changed: boolean;
}

interface ApplyExactTextEditInput {
	cwd?: string;
	path: string;
	oldText: string;
	newText: string;
}

interface ApplyExactTextEditResult {
	path: string;
	changed: boolean;
}

function findExactMatchOffsets(source: string, target: string): number[] {
	if (target.length === 0) {
		throw new FileEditError(
			"empty_old_text",
			"Expected text must be non-empty.",
		);
	}

	const matches: number[] = [];
	let searchStart = 0;
	while (searchStart <= source.length - target.length) {
		const matchIndex = source.indexOf(target, searchStart);
		if (matchIndex === -1) break;
		matches.push(matchIndex);
		searchStart = matchIndex + 1;
	}
	return matches;
}

export function planExactTextEdit(
	source: string,
	oldText: string,
	newText: string,
): PlannedExactTextEdit {
	const matches = findExactMatchOffsets(source, oldText);
	if (matches.length === 0) {
		throw new FileEditError(
			"target_not_found",
			"Expected text was not found in the file.",
		);
	}
	if (matches.length > 1) {
		throw new FileEditError(
			"target_not_unique",
			"Expected text matched multiple locations in the file.",
		);
	}

	const matchIndex = matches[0] ?? 0;
	const updated =
		source.slice(0, matchIndex) +
		newText +
		source.slice(matchIndex + oldText.length);

	return {
		updated,
		changed: updated !== source,
	};
}

export async function applyExactTextEdit(
	input: ApplyExactTextEditInput,
): Promise<ApplyExactTextEditResult> {
	const { filePath, relPath } = resolvePath(input.cwd, input.path);
	const file = Bun.file(filePath);
	if (!(await file.exists())) {
		throw new FileEditError("file_not_found", `File not found: "${relPath}".`);
	}

	const original = await file.text();
	const plan = planExactTextEdit(original, input.oldText, input.newText);
	if (plan.changed) {
		await Bun.write(filePath, plan.updated);
	}

	return {
		path: relPath,
		changed: plan.changed,
	};
}
