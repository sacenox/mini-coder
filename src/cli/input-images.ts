import { join } from "node:path";
import {
	type ImageAttachment,
	isImageFilename,
	loadImageFile,
} from "./image-types.ts";

export async function tryExtractImageFromPaste(
	pasted: string,
	cwd: string,
	loadImage: (path: string) => Promise<ImageAttachment | null> = loadImageFile,
): Promise<{ attachment: ImageAttachment; label: string } | null> {
	const trimmed = pasted.trim();

	if (trimmed.startsWith("data:image/")) {
		const commaIdx = trimmed.indexOf(",");
		if (commaIdx !== -1 && trimmed.slice(0, commaIdx).includes(";base64")) {
			const header = trimmed.slice(0, commaIdx);
			const b64 = trimmed.slice(commaIdx + 1);
			const mediaType = header.split(";")[0]?.slice(5) ?? "image/png";
			return {
				attachment: { data: b64, mediaType },
				label: `[image: ${mediaType}]`,
			};
		}
	}

	if (!trimmed.includes(" ") && isImageFilename(trimmed)) {
		const filePath = trimmed.startsWith("/") ? trimmed : join(cwd, trimmed);
		const attachment = await loadImage(filePath);
		if (attachment) {
			const name = filePath.split("/").pop() ?? trimmed;
			return { attachment, label: `[image: ${name}]` };
		}
	}

	return null;
}
