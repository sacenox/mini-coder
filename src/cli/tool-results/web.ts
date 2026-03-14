import * as c from "yoctocolors";
import { G, writeln } from "../output.ts";

export function renderWebSearchResult(result: unknown): boolean {
	const r = result as {
		results?: Array<{ title?: string; url?: string; score?: number }>;
	};
	if (!Array.isArray(r?.results)) return false;
	if (r.results.length === 0) {
		writeln(`    ${G.info} ${c.dim("no results")}`);
		return true;
	}

	for (const item of r.results.slice(0, 5)) {
		const title = (item.title?.trim() || item.url || "(untitled)").replace(
			/\s+/g,
			" ",
		);
		const score =
			typeof item.score === "number"
				? c.dim(` (${item.score.toFixed(2)})`)
				: "";
		writeln(`    ${c.dim("•")} ${title}${score}`);
		if (item.url) writeln(`      ${c.dim(item.url)}`);
	}

	if (r.results.length > 5) {
		writeln(`    ${c.dim(`  +${r.results.length - 5} more`)}`);
	}
	return true;
}

export function renderWebContentResult(result: unknown): boolean {
	const r = result as {
		results?: Array<{ url?: string; title?: string; text?: string }>;
	};
	if (!Array.isArray(r?.results)) return false;
	if (r.results.length === 0) {
		writeln(`    ${G.info} ${c.dim("no pages")}`);
		return true;
	}

	for (const item of r.results.slice(0, 3)) {
		const title = (item.title?.trim() || item.url || "(untitled)").replace(
			/\s+/g,
			" ",
		);
		writeln(`    ${c.dim("•")} ${title}`);
		if (item.url) writeln(`      ${c.dim(item.url)}`);
		const preview = (item.text ?? "").replace(/\s+/g, " ").trim();
		if (preview) {
			const trimmed =
				preview.length > 220 ? `${preview.slice(0, 217)}…` : preview;
			writeln(`      ${c.dim(trimmed)}`);
		}
	}

	if (r.results.length > 3) {
		writeln(`    ${c.dim(`  +${r.results.length - 3} more`)}`);
	}
	return true;
}
