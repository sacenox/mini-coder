export function normalizeReasoningDelta(delta: string): string {
	return delta.replace(/\r\n?/g, "\n");
}

export function normalizeReasoningText(text: string): string {
	const normalized = normalizeReasoningDelta(text);
	const lines = normalized
		.split("\n")
		.map((line) => line.replace(/[ \t]+$/g, ""));

	let start = 0;
	while (start < lines.length && lines[start]?.trim() === "") start++;

	let end = lines.length - 1;
	while (end >= start && lines[end]?.trim() === "") end--;

	if (start > end) return "";

	const compact: string[] = [];
	let blankRun = 0;
	for (const line of lines.slice(start, end + 1)) {
		if (line.trim() === "") {
			blankRun += 1;
			if (blankRun <= 1) compact.push("");
			continue;
		}
		blankRun = 0;
		compact.push(line);
	}

	return compact.join("\n");
}
