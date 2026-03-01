import * as c from "yoctocolors";
import { logError } from "./error-log.ts";
import { parseAppError } from "./error-parse.ts";
import { G, writeln } from "./output.ts";

export function renderError(err: unknown, context = "render"): void {
	logError(err, context);
	const parsed = parseAppError(err);
	writeln(`${G.err} ${c.red(parsed.headline)}`);
	if (parsed.hint) {
		writeln(`  ${c.dim(parsed.hint)}`);
	}
}
