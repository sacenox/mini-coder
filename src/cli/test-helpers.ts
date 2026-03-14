/** Temporarily set process.stdout.columns for terminal tests. */
export async function withTerminalColumns(
	cols: number,
	fn: () => Promise<void> | void,
): Promise<void> {
	const out = process.stdout as NodeJS.WriteStream & { columns?: number };
	const previous = Object.getOwnPropertyDescriptor(out, "columns");
	Object.defineProperty(out, "columns", {
		value: cols,
		configurable: true,
		writable: true,
	});
	try {
		await fn();
	} finally {
		if (previous) {
			Object.defineProperty(out, "columns", previous);
		} else {
			Object.defineProperty(out, "columns", {
				value: undefined,
				configurable: true,
				writable: true,
			});
		}
	}
}
