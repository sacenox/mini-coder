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
// Myers diff algorithm (Eugene Myers, 1986)
// O(n * d) time and space where n = max(m, n_after), d = edit distance.
// For typical small-edit cases this is far more memory-efficient than the
// previous LCS approach which always allocated O(m * n) space.
// ---------------------------------------------------------------------------

type EditKind = "eq" | "del" | "ins";
type EditOp = { kind: EditKind; line: string };

/**
 * Produce a minimal edit script (sequence of eq/del/ins operations) using the
 * Myers diff algorithm with trace-based backtracking.
 */
function editScript(before: string[], after: string[]): EditOp[] {
	const m = before.length;
	const n = after.length;

	if (m === 0) return after.map((line) => ({ kind: "ins" as const, line }));
	if (n === 0) return before.map((line) => ({ kind: "del" as const, line }));

	const max = m + n;
	const offset = max; // shift so negative diagonal indices are valid array indices
	// V[k + offset] = furthest x reached on diagonal k
	const V = new Int32Array(2 * max + 2);
	// Snapshot of V at the start of each edit-distance iteration d, used for
	// backtracking.  trace[d] is the state when d edits have already been applied.
	const trace: Int32Array[] = [];

	outer: for (let d = 0; d <= max; d++) {
		trace.push(V.slice());
		for (let k = -d; k <= d; k += 2) {
			// Decide whether to move down (insert from after) or right (delete from before).
			const fromInsert =
				k === -d ||
				(k !== d &&
					(V[k - 1 + offset] as number) < (V[k + 1 + offset] as number));
			let x = fromInsert
				? (V[k + 1 + offset] as number)
				: (V[k - 1 + offset] as number) + 1;
			let y = x - k;
			// Follow the snake: advance while lines are equal.
			while (x < m && y < n && before[x] === after[y]) {
				x++;
				y++;
			}
			V[k + offset] = x;
			if (x >= m && y >= n) break outer;
		}
	}

	// Backtrack through the trace snapshots to reconstruct the edit script in
	// reverse, then flip at the end.
	const ops: EditOp[] = [];
	let x = m;
	let y = n;

	for (let d = trace.length - 1; d >= 1; d--) {
		const Vd = trace[d] as Int32Array;
		const k = x - y;
		const fromInsert =
			k === -d ||
			(k !== d &&
				(Vd[k - 1 + offset] as number) < (Vd[k + 1 + offset] as number));
		const prevX = fromInsert
			? (Vd[k + 1 + offset] as number)
			: (Vd[k - 1 + offset] as number);
		const prevY = prevX - (fromInsert ? k + 1 : k - 1);

		// Snake: equal lines between the end of this edit and the current position.
		// Recorded in reverse because we are walking backwards.
		for (let i = x - 1; i >= prevX + (fromInsert ? 0 : 1); i--) {
			ops.push({ kind: "eq", line: before[i] as string });
		}
		if (fromInsert) {
			ops.push({ kind: "ins", line: after[prevY] as string });
		} else {
			ops.push({ kind: "del", line: before[prevX] as string });
		}
		x = prevX;
		y = prevY;
	}

	// Remaining equal prefix (before the first edit).
	for (let i = x - 1; i >= 0; i--) {
		ops.push({ kind: "eq", line: before[i] as string });
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
