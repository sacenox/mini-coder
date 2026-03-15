import * as c from "yoctocolors";
import { PREFIX, writeln } from "./output.ts";
import type { CommandContext } from "./types.ts";

function handleBooleanToggleCommand(opts: {
	args: string;
	current: boolean;
	set: (value: boolean) => void;
	label: string;
	usage: string;
}): void {
	const mode = opts.args.trim().toLowerCase();
	if (!mode) {
		const nextValue = !opts.current;
		opts.set(nextValue);
		writeln(
			`${PREFIX.success} ${opts.label} ${nextValue ? c.green("on") : c.dim("off")}`,
		);
		return;
	}

	if (mode === "on") {
		opts.set(true);
		writeln(`${PREFIX.success} ${opts.label} ${c.green("on")}`);
		return;
	}

	if (mode === "off") {
		opts.set(false);
		writeln(`${PREFIX.success} ${opts.label} ${c.dim("off")}`);
		return;
	}

	writeln(`${PREFIX.error} usage: ${opts.usage}`);
}

export function handleReasoningCommand(
	ctx: CommandContext,
	args: string,
): void {
	handleBooleanToggleCommand({
		args,
		current: ctx.showReasoning,
		set: (value) => ctx.setShowReasoning(value),
		label: "reasoning display",
		usage: "/reasoning <on|off>",
	});
}

export function handleVerboseCommand(ctx: CommandContext, args: string): void {
	handleBooleanToggleCommand({
		args,
		current: ctx.verboseOutput,
		set: (value) => ctx.setVerboseOutput(value),
		label: "verbose output",
		usage: "/verbose <on|off>",
	});
}

export function handleContextCommand(ctx: CommandContext, args: string): void {
	const [subcommand, value] = args.trim().split(/\s+/, 2);
	if (!subcommand) {
		const capText =
			ctx.toolResultPayloadCapBytes <= 0
				? "off"
				: `${Math.round(ctx.toolResultPayloadCapBytes / 1024)}KB (${ctx.toolResultPayloadCapBytes} bytes)`;
		writeln(
			`${PREFIX.info} pruning=${c.cyan(ctx.pruningMode)}  tool-result-cap=${c.cyan(capText)}`,
		);
		writeln(c.dim("  usage: /context prune <off|balanced|aggressive>"));
		writeln(c.dim("         /context cap <off|bytes|kb>"));
		return;
	}

	if (subcommand === "prune") {
		if (value === "off" || value === "balanced" || value === "aggressive") {
			ctx.setPruningMode(value);
			writeln(`${PREFIX.success} context pruning → ${c.cyan(value)}`);
			return;
		}
		writeln(`${PREFIX.error} usage: /context prune <off|balanced|aggressive>`);
		return;
	}

	if (subcommand !== "cap") {
		writeln(`${PREFIX.error} usage: /context <prune|cap> ...`);
		return;
	}

	if (!value) {
		writeln(`${PREFIX.error} usage: /context cap <off|bytes|kb>`);
		return;
	}

	if (value === "off") {
		ctx.setToolResultPayloadCapBytes(0);
		writeln(`${PREFIX.success} tool-result payload cap disabled`);
		return;
	}

	const capMatch = value.match(/^(\d+)(kb)?$/i);
	if (!capMatch) {
		writeln(`${PREFIX.error} invalid cap: ${c.cyan(value)}`);
		return;
	}

	const base = Number.parseInt(capMatch[1] ?? "", 10);
	const capBytes =
		(capMatch[2] ?? "").toLowerCase() === "kb" ? base * 1024 : base;
	if (!Number.isFinite(capBytes) || capBytes < 0) {
		writeln(`${PREFIX.error} invalid cap: ${c.cyan(value)}`);
		return;
	}

	ctx.setToolResultPayloadCapBytes(capBytes);
	writeln(
		`${PREFIX.success} tool-result payload cap → ${c.cyan(`${capBytes} bytes`)}`,
	);
}

export function handleCacheCommand(ctx: CommandContext, args: string): void {
	const [subcommand, value] = args.trim().split(/\s+/, 2);

	if (!subcommand) {
		const geminiCache = ctx.googleCachedContent
			? c.cyan(ctx.googleCachedContent)
			: "off";
		writeln(
			`${PREFIX.info} prompt-caching=${ctx.promptCachingEnabled ? c.green("on") : c.dim("off")}  openai-retention=${c.cyan(ctx.openaiPromptCacheRetention)}  gemini-cache=${geminiCache}`,
		);
		writeln(c.dim("  usage: /cache <on|off>"));
		writeln(c.dim("         /cache openai <in_memory|24h>"));
		writeln(c.dim("         /cache gemini <off|cachedContents/...>"));
		return;
	}

	if (subcommand === "on" || subcommand === "off") {
		ctx.setPromptCachingEnabled(subcommand === "on");
		writeln(
			`${PREFIX.success} prompt caching → ${subcommand === "on" ? c.green("on") : c.dim("off")}`,
		);
		return;
	}

	if (subcommand === "openai") {
		if (value === "in_memory" || value === "24h") {
			ctx.setOpenAIPromptCacheRetention(value);
			writeln(
				`${PREFIX.success} openai prompt cache retention → ${c.cyan(value)}`,
			);
			return;
		}
		writeln(`${PREFIX.error} usage: /cache openai <in_memory|24h>`);
		return;
	}

	if (subcommand !== "gemini") {
		writeln(`${PREFIX.error} usage: /cache <on|off|openai|gemini> ...`);
		return;
	}

	if (!value) {
		writeln(`${PREFIX.error} usage: /cache gemini <off|cachedContents/...>`);
		return;
	}

	if (value === "off") {
		ctx.setGoogleCachedContent(null);
		writeln(`${PREFIX.success} gemini cached content → ${c.dim("off")}`);
		return;
	}

	ctx.setGoogleCachedContent(value);
	writeln(`${PREFIX.success} gemini cached content → ${c.cyan(value)}`);
}
