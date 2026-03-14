import type { Readable } from "node:stream";

function chunkToString(chunk: unknown): string {
	if (typeof chunk === "string") return chunk;
	if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString("utf8");
	return String(chunk);
}

async function readStreamText(stream: Readable): Promise<string> {
	let text = "";
	for await (const chunk of stream) {
		text += chunkToString(chunk);
	}
	return text;
}

export async function resolvePromptInput(
	promptArg: string | null,
	opts?: {
		stdin?: Readable;
		stdinIsTTY?: boolean;
	},
): Promise<string | null> {
	if (promptArg) return promptArg;

	const stdinIsTTY = opts?.stdinIsTTY ?? process.stdin.isTTY;
	if (stdinIsTTY) return null;

	const stdin = opts?.stdin ?? process.stdin;
	const piped = await readStreamText(stdin);
	const trimmed = piped.trim();
	return trimmed.length > 0 ? trimmed : null;
}
