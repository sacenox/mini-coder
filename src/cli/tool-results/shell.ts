import * as c from "yoctocolors";
import { writeln } from "../output.ts";
import { writePreviewLines } from "../tool-result-shared.ts";

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

	writeln(
		`    ${badge} ${c.dim(`exit ${r.exitCode} · stdout ${stdoutLines}L · stderr ${stderrLines}L`)}`,
	);

	if (
		r.success &&
		!r.timedOut &&
		stderrLines === 0 &&
		stdoutSingleLine !== null
	) {
		const compact =
			stdoutSingleLine.length > 100
				? `${stdoutSingleLine.slice(0, 97)}…`
				: stdoutSingleLine;
		if (compact.length > 0) {
			writeln(`    ${c.dim(`stdout: ${compact}`)}`);
		}
		return true;
	}

	if (!r.success || r.timedOut) {
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

	if (stderrLines > 0) {
		writePreviewLines({
			label: "stderr",
			value: r.stderr,
			lineColor: c.red,
			maxLines: 4,
		});
	}

	if (stdoutLines > 0 && stdoutLines <= 3) {
		writePreviewLines({
			label: "stdout",
			value: r.stdout,
			lineColor: c.dim,
			maxLines: 3,
		});
	} else if (stdoutLines > 3) {
		writeln(`    ${c.dim(`stdout omitted (${stdoutLines} lines)`)}`);
	}

	return true;
}
