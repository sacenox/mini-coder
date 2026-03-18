/** Pre-compiled regex for ANSI color/style escape sequences. */
const ANSI_REGEX = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g");

/** Strip ANSI color/style escape sequences from a string. */
export function stripAnsi(text: string): string {
	return text.replace(ANSI_REGEX, "");
}
