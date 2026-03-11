import { generateDiff } from "./diff.ts";

export interface WriteResultMeta {
	_filePath: string;
	_before: string;
}

interface FinalizableWriteResult extends WriteResultMeta {
	path: string;
	diff: string;
}

export function stripWriteResultMeta<T extends WriteResultMeta>(
	result: T,
): Omit<T, keyof WriteResultMeta> {
	const { _filePath, _before, ...publicResult } = result;
	return publicResult;
}

export async function finalizeWriteResult<T extends FinalizableWriteResult>(
	result: T,
): Promise<Omit<T, keyof WriteResultMeta>> {
	const file = Bun.file(result._filePath);
	const after = (await file.exists()) ? await file.text() : "";

	return {
		...stripWriteResultMeta(result),
		diff: generateDiff(result.path, result._before, after),
	};
}
