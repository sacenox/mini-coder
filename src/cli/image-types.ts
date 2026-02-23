// ─── Shared image type constants ──────────────────────────────────────────────

export const IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"bmp",
	"tiff",
	"tif",
	"avif",
	"heic",
]);

/** Returns true if the string looks like a path/filename for an image file. */
export function isImageFilename(s: string): boolean {
	const dotIdx = s.lastIndexOf(".");
	if (dotIdx === -1 || dotIdx === 0) return false; // no dot, or leading dot only
	const ext = s.slice(dotIdx + 1).toLowerCase();
	return IMAGE_EXTENSIONS.has(ext);
}

/** base64-encoded image data and MIME type. */
export interface ImageAttachment {
	/** base64-encoded image data (no data-URL prefix) */
	data: string;
	/** MIME type, e.g. "image/png" */
	mediaType: string;
}

/**
 * Loads an image file from disk and returns an ImageAttachment, or null if the
 * file doesn't exist or isn't readable. Derives mediaType from the file
 * extension when Bun can't determine it, so exotic formats like .heic/.avif
 * don't fall back incorrectly to "image/png".
 */
export async function loadImageFile(
	filePath: string,
): Promise<ImageAttachment | null> {
	try {
		const file = Bun.file(filePath);
		if (!(await file.exists())) return null;
		const buf = await file.arrayBuffer();
		const b64 = Buffer.from(buf).toString("base64");
		const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
		const mediaType =
			file.type || `image/${ext === "jpg" ? "jpeg" : ext}` || "image/png";
		return { data: b64, mediaType };
	} catch {
		return null;
	}
}
