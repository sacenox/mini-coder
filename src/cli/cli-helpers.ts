import * as c from "yoctocolors";
import type { AgentReporter } from "../agent/reporter.ts";

export async function getGitBranch(cwd: string): Promise<string | null> {
	try {
		const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const out = await new Response(proc.stdout).text();
		const code = await proc.exited;
		if (code !== 0) return null;
		return out.trim() || null;
	} catch {
		return null;
	}
}

export async function runShellPassthrough(
	command: string,
	cwd: string,
	reporter: AgentReporter,
): Promise<string> {
	const proc = Bun.spawn(["bash", "-c", command], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	try {
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		await proc.exited;
		const out = [stdout, stderr].filter(Boolean).join("\n").trim();
		if (out) reporter.writeText(c.dim(out));
		return out;
	} finally {
		reporter.restoreTerminal();
	}
}
