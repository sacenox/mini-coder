export function resolveProcessScriptPath(
	mainModule: string | undefined,
	argv1: string | undefined,
): string | null {
	const script =
		mainModule &&
		!mainModule.endsWith("/[eval]") &&
		!mainModule.endsWith("\\[eval]")
			? mainModule
			: argv1;

	return script && /\.(?:[cm]?[jt]s)$/.test(script) ? script : null;
}
