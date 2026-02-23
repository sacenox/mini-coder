# Image Support Plan

## Overview

Three entry points, one unified path: images from `@file`, clipboard paste, or terminal drag-and-drop all resolve to **base64 image content parts** that get inserted into the user `CoreMessage` sent to the LLM.

---

## 1. Data Model — extend `CoreMessage` content

The AI SDK's `CoreUserMessage` already supports multi-part content: `{ role: "user", content: [...parts] }` where a part can be `{ type: "image", image: <base64|URL>, mimeType: "image/png" }`. No new types needed — we just need to build content arrays instead of plain strings.

**Change in `src/agent/agent.ts` `processUserInput`:**
```ts
// Today:
const userMsg: CoreMessage = { role: "user", content: coreContent };

// With images:
const userMsg: CoreMessage = {
  role: "user",
  content: [
    { type: "text", text: coreContent },
    ...images,  // ImagePart[]
  ],
};
```

---

## 2. Source A — `@path` image file references (`src/agent/agent.ts`)

Extend `resolveFileRefs` (or split it into `resolveFileRefs` + `extractImageRefs`):

- Detect image extensions in `@` tokens: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`
- Instead of inlining as a fenced code block, **remove** the token from the text and return an `ImagePart` array alongside the resolved text
- The function signature becomes:
  ```ts
  async function resolveRefs(
    text: string, cwd: string
  ): Promise<{ text: string; images: ImagePart[] }>
  ```
- Update the TAB autocomplete in `src/cli/input.ts` to also surface image files (already works via glob)

---

## 3. Source B — Clipboard paste (`src/cli/input.ts`)

Terminals emit **bracketed paste** sequences when pasting: `\x1B[?2004h` to enable, `\x1B[200~...content...\x1B[201~` wrapping the pasted data.

- Enable bracketed paste mode on raw input start: write `\x1B[?2004h`
- Disable on exit: write `\x1B[?2004l`
- In the input loop, detect `\x1B[200~` … `\x1B[201~` sequences
- If bracketed content looks like an **image** (base64 data URI `data:image/...;base64,...`), extract it as an image — don't insert it into the text buffer
- Surface it as a new `InputResult` variant: `{ type: "submit"; text: string; images: ImagePart[] }` (images field added, optional/defaults to `[]`)

For actual image data pasted from clipboard (e.g. from macOS Screenshot), the image bytes arrive as raw binary, not text. We can detect that with a quick magic-bytes check (`\x89PNG`, `\xff\xd8\xff`, etc.) and base64-encode it ourselves.

---

## 4. Source C — Terminal drag-and-drop / file drop

Most modern terminals (iTerm2, Kitty, WezTerm) emit file paths when files are dropped as either:
- Plain text paths (already handled by `@` detection if user types `@`, but auto-drops won't have `@`)
- **Escape sequences** like `\x1B]1337;File=...` (iTerm2 inline image protocol) or `\x1B]5113;...` (Kitty file drop)

Strategy:
- In the input loop, detect these escape sequences and extract the file path or inline image data
- If the dropped item is an image path, read it as an `ImagePart`
- If it's a non-image file path, auto-insert `@path` into the buffer (existing file ref behavior)
- If it's raw inline image data (iTerm2 `\x1B]1337;File=inline=1;...:<base64>`), extract the base64 directly

---

## 5. `InputResult` type extension (`src/cli/input.ts`)

```ts
export type InputResult =
  | { type: "submit"; text: string; images?: ImagePart[] }
  | { type: "interrupt" }
  | { type: "eof" }
  | { type: "command"; command: string; args: string }
  | { type: "shell"; command: string };
```

The `images` field is optional so nothing breaks at existing call sites.

---

## 6. UI feedback (`src/cli/output.ts`)

When images are attached, render a compact indicator below the prompt echo:
```
› analyze this screenshot
  📎 image/png  1024×768  (paste)
  📎 src/assets/logo.png  (file)
```
A new `renderImageAttachments(images: ImageMeta[])` helper, where `ImageMeta` carries mime type, source, and optionally dimensions (from magic bytes).

---

## 7. New module: `src/cli/images.ts`

Isolate all image logic here:
- `detectMimeType(bytes: Uint8Array): string | null` — magic bytes check
- `readImageFile(path: string): Promise<ImagePart | null>` — file → base64 ImagePart
- `parsePastedImage(raw: Uint8Array): ImagePart | null` — bracketed paste → ImagePart
- `parseITermDrop(seq: string): ImagePart | null` — iTerm2 escape → ImagePart
- Constants for supported extensions and magic bytes

This keeps `input.ts` and `agent.ts` clean.

---

## 8. Session persistence

Images in messages are already persisted via `saveMessages` — the AI SDK `CoreMessage` with image parts serializes to JSON cleanly in SQLite. No schema changes needed.

---

## Implementation order

1. **`src/cli/images.ts`** — new module, pure functions, fully testable
2. **`src/agent/agent.ts`** — extend `resolveRefs` to handle image `@` references
3. **`src/cli/input.ts`** — bracketed paste + file drop detection
4. **`src/cli/output.ts`** — `renderImageAttachments` helper
5. **Wire up** in `agent.ts` `processUserInput` and the REPL switch

---

## Key constraints

- Only models that support vision will accept image parts — the AI SDK will surface a provider error if the model doesn't; we don't need to guard this ourselves
- Keep images **out of prompt history display** (don't echo base64 to terminal)
- Max image size guard: reject files > ~5 MB before sending (configurable constant)
- No new dependencies — Bun's built-in `Bun.file` for reading, `Buffer.from(...).toString("base64")` for encoding
