import { join } from "node:path";
import {
	type ImageAttachment,
	isImageFilename,
	loadImageFile,
} from "./image-types.ts";

export async function resolveFileRefs(
	text: string,
	cwd: string,
): Promise<{ text: string; images: ImageAttachment[] }> {
	const atPattern = /@([\w./\-_]+)/g;
	let result = text;
	const matches = [...text.matchAll(atPattern)];
	const images: ImageAttachment[] = [];

	for (const match of [...matches].reverse()) {
		const ref = match[1];
		if (!ref) continue;

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
