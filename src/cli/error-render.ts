import * as c from "yoctocolors";
import { logError } from "./error-log.ts";
import { parseAppError } from "./error-parse.ts";
import { G, writeln } from "./output.ts";

/**
 * Thrown after an error has already been rendered to the terminal.
 * Outer catch blocks can check for this to avoid re-displaying the same error.
 */
export class RenderedError extends Error {
	public readonly cause: unknown;
	constructor(cause: unknown) {
		super("already rendered");
		this.name = "RenderedError";
		this.cause = cause;
	}
}

export function renderError(err: unknown, context = "render"): void {
	logError(err, context);
	const parsed = parseAppError(err);
	writeln(`${G.err} ${c.red(parsed.headline)}`);
	if (parsed.hint) {
		writeln(`  ${c.dim(parsed.hint)}`);
	}
}
