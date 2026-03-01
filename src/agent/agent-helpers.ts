import { join } from "node:path";
import * as c from "yoctocolors";
import {
	type ImageAttachment,
	isImageFilename,
	loadImageFile,
} from "../cli/image-types.ts";
import { loadSkills } from "../cli/skills.ts";
import type { CoreMessage } from "../llm-api/turn.ts";
import type { AgentReporter } from "./reporter.ts";

export function makeInterruptMessage(reason: "user" | "error"): CoreMessage {
	const text =
		reason === "user"
			? "<system-message>Response was interrupted by the user.</system-message>"
			: "<system-message>Response was interrupted due to an error.</system-message>";
	return { role: "assistant", content: text };
}

export function extractAssistantText(newMessages: CoreMessage[]): string {
	const parts: string[] = [];
	for (const msg of newMessages) {
		if (msg.role !== "assistant") continue;
		const content = msg.content;
		if (typeof content === "string") {
			parts.push(content);
		} else if (Array.isArray(content)) {
			for (const part of content as Array<{ type?: string; text?: string }>) {
				if (part?.type === "text" && part.text) parts.push(part.text);
			}
		}
	}
	return parts.join("\n");
}

export function hasRalphSignal(text: string): boolean {
	return /\/ralph\b/.test(text);
}

export async function resolveFileRefs(
	text: string,
	cwd: string,
): Promise<{ text: string; images: ImageAttachment[] }> {
	const atPattern = /@([\w./\-_]+)/g;
	let result = text;
	const matches = [...text.matchAll(atPattern)];
	const images: ImageAttachment[] = [];

	const skills = loadSkills(cwd);

	for (const match of [...matches].reverse()) {
		const ref = match[1];
		if (!ref) continue;

		const skill = skills.get(ref);
		if (skill) {
			const replacement = `<skill name="${skill.name}">\n${skill.content}\n</skill>`;
			result =
				result.slice(0, match.index) +
				replacement +
				result.slice((match.index ?? 0) + match[0].length);
			continue;
		}

		const filePath = ref.startsWith("/") ? ref : join(cwd, ref);

		if (isImageFilename(ref)) {
			const attachment = await loadImageFile(filePath);
			if (attachment) {
				images.unshift(attachment);
				result =
					result.slice(0, match.index) +
					result.slice((match.index ?? 0) + match[0].length);
				continue;
			}
		}

		try {
			const content = await Bun.file(filePath).text();
			const lines = content.split("\n");
			const preview =
				lines.length > 200
					? `${lines.slice(0, 200).join("\n")}\n[truncated]`
					: content;
			const replacement = `\`${ref}\`:\n\`\`\`\n${preview}\n\`\`\``;
			result =
				result.slice(0, match.index) +
				replacement +
				result.slice((match.index ?? 0) + match[0].length);
		} catch {}
	}

	return { text: result, images };
}

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
