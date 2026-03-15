import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProcessScriptPath } from "../runtime/script.ts";

function quoteShellArg(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function resolveSiblingFileEditScript(scriptPath: string): string | null {
	const ext = extname(scriptPath);
	if (!ext) return null;

	const mainDir = dirname(scriptPath);
	const mainBase = scriptPath.slice(mainDir.length + 1);
	if (mainBase === `index${ext}` || mainBase === `mc${ext}`) {
		return join(mainDir, `mc-edit${ext}`);
	}

	return null;
}

function resolveModuleLocalFileEditScript(moduleUrl: string): string | null {
	const modulePath = fileURLToPath(moduleUrl);
	const ext = extname(modulePath);
	if (!ext) return null;

	const helperPath = join(dirname(modulePath), "..", "..", `mc-edit${ext}`);
	return existsSync(helperPath) ? helperPath : null;
}

export function resolveFileEditCommand(
	execPath: string,
	mainModule: string | undefined,
	argv1: string | undefined,
	moduleUrl = import.meta.url,
): string[] {
	const scriptPath = resolveProcessScriptPath(mainModule, argv1);
	const helperScript = scriptPath
		? resolveSiblingFileEditScript(scriptPath)
		: null;
	if (helperScript) {
		return [execPath, helperScript];
	}

	const moduleLocalHelper = resolveModuleLocalFileEditScript(moduleUrl);
	if (moduleLocalHelper) {
		return [execPath, moduleLocalHelper];
	}

	return ["mc-edit"];
}

function getFileEditCommand(): string[] {
	return resolveFileEditCommand(process.execPath, Bun.main, process.argv[1]);
}

export function buildFileEditShellPrelude(
	command = getFileEditCommand(),
): string {
	return `mc-edit() { ${command.map(quoteShellArg).join(" ")} "$@"; }`;
}
