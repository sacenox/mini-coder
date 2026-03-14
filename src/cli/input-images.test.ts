import { describe, expect, test } from "bun:test";
import { tryExtractImageFromPaste } from "./input-images.ts";

describe("tryExtractImageFromPaste", () => {
	test("extracts base64 data URLs", async () => {
		const result = await tryExtractImageFromPaste(
			"data:image/png;base64,Zm9v",
			"/tmp",
		);

		expect(result).toEqual({
			attachment: { data: "Zm9v", mediaType: "image/png" },
			label: "[image: image/png]",
		});
	});

	test("ignores non-base64 data URLs", async () => {
		const result = await tryExtractImageFromPaste(
			"data:image/svg+xml,<svg></svg>",
			"/tmp",
		);
		expect(result).toBeNull();
	});

	test("resolves relative image paths", async () => {
		const result = await tryExtractImageFromPaste(
			"assets/logo.png",
			"/repo",
			async (path) => {
				expect(path).toBe("/repo/assets/logo.png");
				return { data: "abc", mediaType: "image/png" };
			},
		);

		expect(result).toEqual({
			attachment: { data: "abc", mediaType: "image/png" },
			label: "[image: logo.png]",
		});
	});

	test("does not treat spaced paths as image attachments", async () => {
		const result = await tryExtractImageFromPaste(
			"my image.png",
			"/repo",
			async () => ({ data: "abc", mediaType: "image/png" }),
		);
		expect(result).toBeNull();
	});
});
