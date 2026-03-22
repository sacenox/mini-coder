import { join } from "node:path";

const MEDIA_TYPE_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
};

/** Derive a file extension from a MIME media type. */
export function extensionFromMediaType(mediaType: string): string {
  if (MEDIA_TYPE_TO_EXT[mediaType]) return MEDIA_TYPE_TO_EXT[mediaType];
  const slash = mediaType.indexOf("/");
  if (slash === -1 || slash === mediaType.length - 1) return "bin";
  return mediaType.slice(slash + 1);
}

interface GeneratedFileData {
  mediaType: string;
  uint8Array: Uint8Array;
}

let counter = 0;

/** Save a generated file to disk, returning the absolute path. */
export async function saveGeneratedFile(
  file: GeneratedFileData,
  cwd: string,
): Promise<string> {
  counter += 1;
  const ext = extensionFromMediaType(file.mediaType);
  const name = `generated-${counter}.${ext}`;
  const filePath = join(cwd, name);
  await Bun.write(filePath, file.uint8Array);
  return filePath;
}
