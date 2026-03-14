import * as c from "yoctocolors";
import { writeln } from "../output.ts";
import { writePreviewLines } from "../tool-result-shared.ts";

function truncateOneLine(value: string, max = 100): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function renderShellResult(result: unknown): boolean {
	const r = result as {
		stdout: string;
		stderr: string;
		exitCode: number;
		success: boolean;
		timedOut: boolean;
	};
	if (!r || typeof r.stdout !== "string" || typeof r.stderr !== "string") {
		return false;
	}

	const badge = r.timedOut
		? c.yellow("timeout")
		: r.success
			? c.green("success")
			: c.red("error");

	const stdoutNormalized = r.stdout.replace(/[\r\n]+$/, "");
	const stderrNormalized = r.stderr.replace(/[\r\n]+$/, "");
	const stdoutLines = stdoutNormalized
		? stdoutNormalized.split(/\r?\n/).length
		: 0;
	const stderrLines = stderrNormalized
		? stderrNormalized.split(/\r?\n/).length
		: 0;
	const stdoutSingleLine =
		stdoutLines === 1 ? (stdoutNormalized.split(/\r?\n/)[0] ?? "") : null;

	const parts = [
		`exit ${r.exitCode}`,
		`stdout ${stdoutLines}L`,
		`stderr ${stderrLines}L`,
	];

	if (
		r.success &&
		!r.timedOut &&
		stderrLines === 0 &&
		stdoutSingleLine !== null &&
		stdoutSingleLine.length > 0
	) {
		parts.push(`out: ${truncateOneLine(stdoutSingleLine)}`);
	}

	writeln(`    ${badge} ${c.dim(parts.join(" · "))}`);

	if (r.success && !r.timedOut) {
		return true;
	}

	writePreviewLines({
		label: "stderr",
		value: r.stderr,
		lineColor: c.red,
		maxLines: 6,
	});
	writePreviewLines({
		label: "stdout",
		value: r.stdout,
		lineColor: c.dim,
		maxLines: 4,
	});

	return true;
}
