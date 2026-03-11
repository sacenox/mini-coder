import { join } from "node:path";
import {
	type ImageAttachment,
	isImageFilename,
	loadImageFile,
} from "./image-types.ts";
import { loadSkills } from "./skills.ts";

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
