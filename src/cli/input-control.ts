const ESC = "\x1B";
const CTRL_C = "\x03";
const CTRL_D = "\x04";

const ESC_BYTE = ESC.charCodeAt(0);
const CTRL_C_BYTE = CTRL_C.charCodeAt(0);
const CTRL_D_BYTE = CTRL_D.charCodeAt(0);

export function getTurnControlAction(
	chunk: Uint8Array,
): "cancel" | "quit" | null {
	if (chunk.length === 1 && chunk[0] === ESC_BYTE) return "cancel";
	for (const byte of chunk) {
		if (byte === CTRL_C_BYTE || byte === CTRL_D_BYTE) return "quit";
	}
	return null;
}
