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
