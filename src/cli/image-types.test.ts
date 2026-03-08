import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isImageFilename, loadImageFile } from "./image-types.ts";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "mc-image-types-test-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("isImageFilename", () => {
	test("accepts supported extensions case-insensitively", () => {
		expect(isImageFilename("photo.JPG")).toBe(true);
		expect(isImageFilename("archive.backup.AvIf")).toBe(true);
	});

	test("rejects dotfiles and unsupported extensions", () => {
		expect(isImageFilename(".png")).toBe(false);
		expect(isImageFilename("README")).toBe(false);
		expect(isImageFilename("vector.svg")).toBe(false);
	});
});

describe("loadImageFile", () => {
	test("loads file data and normalizes jpg media types", async () => {
		const bytes = Buffer.from("abc");
		const filePath = join(dir, "photo.jpg");
		await writeFile(filePath, bytes);

		expect(await loadImageFile(filePath)).toEqual({
			data: bytes.toString("base64"),
			mediaType: "image/jpeg",
		});
	});

	test("preserves supported exotic image extensions", async () => {
		const bytes = Buffer.from([0, 1, 2, 3]);
		const filePath = join(dir, "capture.heic");
		await writeFile(filePath, bytes);

		const attachment = await loadImageFile(filePath);
		expect(attachment?.data).toBe(bytes.toString("base64"));
		expect(attachment?.mediaType).toBe("image/heic");
	});

	test("returns null for missing files", async () => {
		expect(await loadImageFile(join(dir, "missing.png"))).toBeNull();
	});
});
