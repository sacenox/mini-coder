import * as c from "yoctocolors";

const ANSI_ESCAPE = "\u001b";

function stripAnsi(s: string): string {
	if (!s.includes(ANSI_ESCAPE)) return s;
	return s
		.split(ANSI_ESCAPE)
		.map((chunk, idx) => (idx === 0 ? chunk : chunk.replace(/^\[[0-9;]*m/, "")))
		.join("");
}

function truncateAnsi(s: string, maxLen: number): string {
	const plain = stripAnsi(s);
	if (plain.length <= maxLen) return s;
	let visible = 0;
	let i = 0;
	while (i < s.length && visible < maxLen - 1) {
		if (s[i] === "\x1B") {
			while (i < s.length && s[i] !== "m") i++;
		} else {
			visible++;
		}
		i++;
	}
	return s.slice(0, i) + c.dim("…");
}

function fmtTokens(n: number): string {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

export function renderStatusBar(opts: {
	model: string;
	provider: string;
	cwd: string;
	gitBranch: string | null;
	sessionId: string;
	inputTokens: number;
	outputTokens: number;
	contextTokens: number;
	contextWindow: number | null;
	ralphMode?: boolean;
}): void {
	const cols = (process.stdout as NodeJS.WriteStream).columns ?? 80;

	// Build segments from right priority (rightmost items drop first)
	const left: string[] = [c.cyan(opts.model)];
	if (opts.provider && opts.provider !== "zen") left.push(c.dim(opts.provider));
	left.push(c.dim(opts.sessionId.slice(0, 8)));
	if (opts.ralphMode) left.push(c.magenta("↻ ralph"));

	const right: string[] = [];
	if (opts.inputTokens > 0 || opts.outputTokens > 0) {
		right.push(
			c.dim(`↑${fmtTokens(opts.inputTokens)} ↓${fmtTokens(opts.outputTokens)}`),
		);
	}
	if (opts.contextTokens > 0) {
		const ctxRaw = fmtTokens(opts.contextTokens);
		if (opts.contextWindow !== null) {
			const pct = Math.round((opts.contextTokens / opts.contextWindow) * 100);
			const ctxMax = fmtTokens(opts.contextWindow);
			const pctStr = `${pct}%`;
			const colored =
				pct >= 90
					? c.red(pctStr)
					: pct >= 75
						? c.yellow(pctStr)
						: c.dim(pctStr);
			right.push(c.dim(`ctx ${ctxRaw}/${ctxMax} `) + colored);
		} else {
			right.push(c.dim(`ctx ${ctxRaw}`));
		}
	}
	if (opts.gitBranch) right.push(c.dim(`⎇ ${opts.gitBranch}`));

	const cwdDisplay = opts.cwd;

	// Assemble: left  ·  cwd  ·  right (respects terminal width)
	const middle = c.dim(cwdDisplay);
	const sep = c.dim("  ");
	const full = [...left, middle, ...right.reverse()].join(sep);

	const visible = stripAnsi(full);

	const out = visible.length > cols ? truncateAnsi(full, cols - 1) : full;

	process.stdout.write(`${out}\n`);
}
