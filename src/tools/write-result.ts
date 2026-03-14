import { generateDiff } from "./diff.ts";

export interface WriteResultMeta {
	_filePath: string;
	_before: string;
	/** Content that was written — used to compute diff on the no-hook path. */
	_updated: string;
}

interface FinalizableWriteResult extends WriteResultMeta {
	path: string;
}

/**
 * No-hook path: strip internal metadata and compute the diff from the already-
 * written content (avoids a file re-read since no hook rewrote the file).
 */
export function stripWriteResultMeta<
	T extends WriteResultMeta & { path: string },
>(result: T): Omit<T, keyof WriteResultMeta> & { diff: string } {
	const { _filePath: _, _before, _updated, ...publicResult } = result;
	return {
		...(publicResult as Omit<T, keyof WriteResultMeta>),
		diff: generateDiff(result.path, _before, _updated),
	};
}

/**
 * Hook path: re-read the file after the hook ran and compute the diff against
 * the original content. This generates the final diff against the post-hook file,
 * replacing the intermediate diff that was removed from applyFileEdit.
 */
export async function finalizeWriteResult<T extends FinalizableWriteResult>(
	result: T,
): Promise<Omit<T, keyof WriteResultMeta> & { diff: string }> {
	const file = Bun.file(result._filePath);
	const after = (await file.exists()) ? await file.text() : "";
	const { _filePath: _, _before, _updated: __, ...publicResult } = result;
	return {
		...(publicResult as Omit<T, keyof WriteResultMeta>),
		diff: generateDiff(result.path, _before, after),
	};
}
