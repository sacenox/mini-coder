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

function computeUnifiedDiff(before: string[], after: string[]): string {
	const CONTEXT = 3;

	// Find the first differing index and the last differing index in each array
	// independently, so hunk sizes are correct when the two arrays differ in length.
	let firstDiff = -1;
	let lastDiffBefore = -1;
	let lastDiffAfter = -1;

	for (let i = 0; i < before.length; i++) {
		if (before[i] !== after[i]) {
			if (firstDiff === -1) firstDiff = i;
			lastDiffBefore = i;
		}
	}
	for (let i = 0; i < after.length; i++) {
		if (after[i] !== before[i]) {
			if (firstDiff === -1) firstDiff = i;
			lastDiffAfter = i;
		}
	}

	if (firstDiff === -1) return "";

	// Clamp: if one side has no differing lines past firstDiff, end at firstDiff
	if (lastDiffBefore === -1) lastDiffBefore = firstDiff;
	if (lastDiffAfter === -1) lastDiffAfter = firstDiff;

	const hunkStart = Math.max(0, firstDiff - CONTEXT);
	const hunkEndBefore = Math.min(before.length, lastDiffBefore + 1 + CONTEXT);
	const hunkEndAfter = Math.min(after.length, lastDiffAfter + 1 + CONTEXT);

	const lines: string[] = [];
	lines.push(
		`@@ -${hunkStart + 1},${hunkEndBefore - hunkStart} ` +
			`+${hunkStart + 1},${hunkEndAfter - hunkStart} @@`,
	);

	// Context before
	for (let i = hunkStart; i < firstDiff; i++) {
		lines.push(` ${before[i] ?? ""}`);
	}

	// Removed lines
	for (let i = firstDiff; i <= lastDiffBefore && i < before.length; i++) {
		lines.push(`-${before[i] ?? ""}`);
	}

	// Added lines
	for (let i = firstDiff; i <= lastDiffAfter && i < after.length; i++) {
		lines.push(`+${after[i] ?? ""}`);
	}

	// Context after
	for (
		let i = lastDiffBefore + 1;
		i < hunkEndBefore && i < before.length;
		i++
	) {
		lines.push(` ${before[i] ?? ""}`);
	}

	return lines.join("\n");
}
