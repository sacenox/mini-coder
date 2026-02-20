const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const HASH_SCAN_RANGE = 10;

export function hashLine(content: string): string {
	let hash = FNV_OFFSET_BASIS;
	for (let i = 0; i < content.length; i++) {
		hash ^= content.charCodeAt(i);
		hash = (hash * FNV_PRIME) >>> 0;
	}
	const twoHex = (hash & 0xff).toString(16).padStart(2, "0");
	return twoHex;
}

export function formatHashLine(lineNum: number, content: string): string {
	return `${lineNum}:${hashLine(content)}| ${content}`;
}

export function findLineByHash(
	lines: string[],
	hash: string,
	hintLine: number,
): number | null {
	const normalized = hash.toLowerCase();
	const hintIdx = hintLine - 1;
	const foundMatches: number[] = [];

	const matches = (idx: number): boolean => {
		const line = lines[idx] ?? "";
		return hashLine(line) === normalized;
	};

	if (hintIdx >= 0 && hintIdx < lines.length) {
		if (matches(hintIdx)) return hintIdx + 1;
	}

	for (let offset = 1; offset <= HASH_SCAN_RANGE; offset++) {
		const lower = hintIdx - offset;
		if (lower >= 0 && lower < lines.length && matches(lower)) {
			foundMatches.push(lower + 1);
		}
		const higher = hintIdx + offset;
		if (higher >= 0 && higher < lines.length && matches(higher)) {
			foundMatches.push(higher + 1);
		}
	}

	if (foundMatches.length === 1) return foundMatches[0] ?? null;
	return null;
}
