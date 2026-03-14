const emojiLikeRegex = /\p{Extended_Pictographic}/u;
const ansiEscapeChar = String.fromCharCode(0x1b);
const graphemeSegmenter =
	typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
		? new Intl.Segmenter(undefined, { granularity: "grapheme" })
		: null;

function stripSgrAnsi(s: string): string {
	if (!s) return "";
	let out = "";
	for (let i = 0; i < s.length; i++) {
		if (s[i] !== ansiEscapeChar || s[i + 1] !== "[") {
			out += s[i] ?? "";
			continue;
		}

		let j = i + 2;
		while (j < s.length) {
			const ch = s[j] ?? "";
			if ((ch >= "0" && ch <= "9") || ch === ";") {
				j++;
				continue;
			}
			break;
		}

		if (s[j] === "m") {
			i = j;
			continue;
		}

		out += s[i] ?? "";
	}
	return out;
}

function isControlCodePoint(cp: number): boolean {
	return (cp >= 0 && cp <= 0x1f) || (cp >= 0x7f && cp <= 0x9f);
}

function isCombiningCodePoint(cp: number): boolean {
	return (
		(cp >= 0x0300 && cp <= 0x036f) ||
		(cp >= 0x1ab0 && cp <= 0x1aff) ||
		(cp >= 0x1dc0 && cp <= 0x1dff) ||
		(cp >= 0x20d0 && cp <= 0x20ff) ||
		(cp >= 0xfe20 && cp <= 0xfe2f)
	);
}

function isVariationSelector(cp: number): boolean {
	return (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
}

function isWideCodePoint(cp: number): boolean {
	return (
		cp >= 0x1100 &&
		(cp <= 0x115f ||
			cp === 0x2329 ||
			cp === 0x232a ||
			(cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
			(cp >= 0xac00 && cp <= 0xd7a3) ||
			(cp >= 0xf900 && cp <= 0xfaff) ||
			(cp >= 0xfe10 && cp <= 0xfe19) ||
			(cp >= 0xfe30 && cp <= 0xfe6f) ||
			(cp >= 0xff00 && cp <= 0xff60) ||
			(cp >= 0xffe0 && cp <= 0xffe6) ||
			(cp >= 0x1f300 && cp <= 0x1f64f) ||
			(cp >= 0x1f900 && cp <= 0x1f9ff) ||
			(cp >= 0x20000 && cp <= 0x3fffd))
	);
}

function graphemeWidth(grapheme: string): number {
	if (!grapheme) return 0;
	if (emojiLikeRegex.test(grapheme)) return 2;

	let width = 0;
	let hasRegionalIndicator = false;
	for (const ch of grapheme) {
		const cp = ch.codePointAt(0);
		if (cp === undefined) continue;
		if (cp >= 0x1f1e6 && cp <= 0x1f1ff) hasRegionalIndicator = true;
		if (
			isControlCodePoint(cp) ||
			isCombiningCodePoint(cp) ||
			isVariationSelector(cp) ||
			cp === 0x200d ||
			(cp >= 0x1f3fb && cp <= 0x1f3ff)
		) {
			continue;
		}
		width += isWideCodePoint(cp) ? 2 : 1;
	}

	if (hasRegionalIndicator) return 2;
	return width;
}

export function visibleLength(s: string): number {
	if (!s) return 0;
	const plain = stripSgrAnsi(s);
	if (!plain) return 0;

	if (!graphemeSegmenter) {
		let width = 0;
		for (const ch of plain) {
			const cp = ch.codePointAt(0);
			if (cp === undefined || isControlCodePoint(cp)) continue;
			width += isWideCodePoint(cp) ? 2 : 1;
		}
		return width;
	}

	let width = 0;
	for (const { segment } of graphemeSegmenter.segment(plain)) {
		width += graphemeWidth(segment);
	}
	return width;
}
