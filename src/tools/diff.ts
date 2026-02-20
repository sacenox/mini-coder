export function generateDiff(
	filePath: string,
	before: string,
	after: string,
): string {
	const beforeLines = before === "" ? [] : before.split("\n");
	const afterLines = after === "" ? [] : after.split("\n");

	const diff = computeUnifiedDiff(beforeLines, afterLines);

	if (diff.length === 0) return "(no changes)";

	return `--- ${filePath}\n+++ ${filePath}\n${diff}`;
}

// ---------------------------------------------------------------------------
// LCS-based unified diff
// ---------------------------------------------------------------------------

/**
 * Compute the longest common subsequence lengths table for two string arrays.
 * Returns a flat (m+1)*(n+1) array where index i*(n+1)+j holds the LCS length
 * of before[0..i-1] and after[0..j-1].
 */
function lcsTable(before: string[], after: string[]): number[] {
	const m = before.length;
	const n = after.length;
	const w = n + 1;
	const dp: number[] = new Array<number>((m + 1) * w).fill(0);
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (before[i - 1] === after[j - 1]) {
				dp[i * w + j] = (dp[(i - 1) * w + (j - 1)] ?? 0) + 1;
			} else {
				dp[i * w + j] = Math.max(
					dp[(i - 1) * w + j] ?? 0,
					dp[i * w + (j - 1)] ?? 0,
				);
			}
		}
	}
	return dp;
}

type EditKind = "eq" | "del" | "ins";
type EditOp = { kind: EditKind; line: string };

/**
 * Backtrack through the LCS table to produce a sequence of edit operations:
 * - "eq"  : line present in both (context)
 * - "del" : line only in before (removed)
 * - "ins" : line only in after  (added)
 */
function editScript(before: string[], after: string[]): EditOp[] {
	const n = after.length;
	const w = n + 1;
	const dp = lcsTable(before, after);

	const ops: EditOp[] = [];
	let i = before.length;
	let j = after.length;
	while (i > 0 || j > 0) {
		const bLine = before[i - 1] ?? "";
		const aLine = after[j - 1] ?? "";
		if (i > 0 && j > 0 && bLine === aLine) {
			ops.push({ kind: "eq", line: bLine });
			i--;
			j--;
		} else if (
			j > 0 &&
			(i === 0 || (dp[i * w + (j - 1)] ?? 0) >= (dp[(i - 1) * w + j] ?? 0))
		) {
			ops.push({ kind: "ins", line: aLine });
			j--;
		} else {
			ops.push({ kind: "del", line: bLine });
			i--;
		}
	}
	ops.reverse();
	return ops;
}

type IndexedOp = EditOp & { bi: number; ai: number };

function computeUnifiedDiff(before: string[], after: string[]): string {
	const CONTEXT = 3;
	const ops = editScript(before, after);

	// Attach before/after line numbers to every op
	const indexed: IndexedOp[] = [];
	let bi = 0;
	let ai = 0;
	for (const op of ops) {
		indexed.push({ ...op, bi, ai });
		if (op.kind === "eq" || op.kind === "del") bi++;
		if (op.kind === "eq" || op.kind === "ins") ai++;
	}

	// Collect positions of changed ops
	const changedIdx: number[] = [];
	for (let k = 0; k < indexed.length; k++) {
		if (indexed[k]?.kind !== "eq") changedIdx.push(k);
	}

	if (changedIdx.length === 0) return "";

	// Group changed ops into hunks. Two changes belong to the same hunk when
	// the number of equal (context) lines separating them is <= 2*CONTEXT.
	const groups: Array<[number, number]> = [];
	let groupStart = changedIdx[0] ?? 0;
	let groupEnd = changedIdx[0] ?? 0;

	for (let k = 1; k < changedIdx.length; k++) {
		const prev = changedIdx[k - 1] ?? 0;
		const cur = changedIdx[k] ?? 0;
		let equalCount = 0;
		for (let x = prev + 1; x < cur; x++) {
			if (indexed[x]?.kind === "eq") equalCount++;
		}
		if (equalCount > 2 * CONTEXT) {
			groups.push([groupStart, groupEnd]);
			groupStart = cur;
		}
		groupEnd = cur;
	}
	groups.push([groupStart, groupEnd]);

	// Render each group as a unified-diff hunk
	const hunks: string[] = [];
	for (const [gStart, gEnd] of groups) {
		const opStart = Math.max(0, gStart - CONTEXT);
		const opEnd = Math.min(indexed.length - 1, gEnd + CONTEXT);

		const lines: string[] = [];
		let beforeCount = 0;
		let afterCount = 0;
		for (let x = opStart; x <= opEnd; x++) {
			const op = indexed[x];
			if (!op) continue;
			if (op.kind === "eq") {
				lines.push(` ${op.line}`);
				beforeCount++;
				afterCount++;
			} else if (op.kind === "del") {
				lines.push(`-${op.line}`);
				beforeCount++;
			} else {
				lines.push(`+${op.line}`);
				afterCount++;
			}
		}

		const firstOp = indexed[opStart];
		// When a side has no lines (e.g. new file or cleared file), the unified
		// diff convention is to use start=0 rather than start=1.
		const beforeStart = beforeCount === 0 ? 0 : (firstOp?.bi ?? 0) + 1;
		const afterStart = afterCount === 0 ? 0 : (firstOp?.ai ?? 0) + 1;

		hunks.push(
			`@@ -${beforeStart},${beforeCount} +${afterStart},${afterCount} @@\n${lines.join("\n")}`,
		);
	}

	return hunks.join("\n");
}
