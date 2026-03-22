import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  extensionFromMediaType,
  saveGeneratedFile,
} from "./generated-files.ts";

describe("extensionFromMediaType", () => {
  test("maps common image types", () => {
    expect(extensionFromMediaType("image/png")).toBe("png");
    expect(extensionFromMediaType("image/jpeg")).toBe("jpg");
    expect(extensionFromMediaType("image/gif")).toBe("gif");
    expect(extensionFromMediaType("image/webp")).toBe("webp");
    expect(extensionFromMediaType("image/svg+xml")).toBe("svg");
  });

  test("extracts subtype for unknown types", () => {
    expect(extensionFromMediaType("image/bmp")).toBe("bmp");
    expect(extensionFromMediaType("image/tiff")).toBe("tiff");
    expect(extensionFromMediaType("audio/mp3")).toBe("mp3");
  });

  test("returns bin for unparseable types", () => {
    expect(extensionFromMediaType("")).toBe("bin");
    expect(extensionFromMediaType("invalid")).toBe("bin");
  });
});

describe("saveGeneratedFile", () => {
  test("saves file to disk and returns path", async () => {
    const dir = join(import.meta.dir, "../../.test-tmp-generated");
    await Bun.write(join(dir, ".gitkeep"), "");

    const data = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
    const filePath = await saveGeneratedFile(
      { mediaType: "image/png", uint8Array: data },
      dir,
    );

    expect(filePath).toMatch(/generated-\d+\.png$/);
    const file = Bun.file(filePath);
    expect(await file.exists()).toBe(true);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(data);

    // cleanup
    const { rm } = await import("node:fs/promises");
    await rm(dir, { recursive: true });
  });

  test("increments counter to avoid collisions", async () => {
    const dir = join(import.meta.dir, "../../.test-tmp-generated2");
    await Bun.write(join(dir, ".gitkeep"), "");

    const data = new Uint8Array([0xff, 0xd8]); // JPEG magic
    const path1 = await saveGeneratedFile(
      { mediaType: "image/jpeg", uint8Array: data },
      dir,
    );
    const path2 = await saveGeneratedFile(
      { mediaType: "image/jpeg", uint8Array: data },
      dir,
    );

    expect(path1).not.toBe(path2);
    expect(await Bun.file(path1).exists()).toBe(true);
    expect(await Bun.file(path2).exists()).toBe(true);

    // cleanup
    const { rm } = await import("node:fs/promises");
    await rm(dir, { recursive: true });
  });
});
