import { relative, resolve, sep } from "node:path";

interface ScanPathInfo {
	absolute: string;
	relativePath: string;
	ignoreTargets: readonly string[];
	inCwd: boolean;
}

const LEADING_PARENT_SEGMENTS = /^(?:\.\.\/)+/;

export function getScannedPathInfo(
	cwd: string,
	scanPath: string,
): ScanPathInfo {
	const cwdAbsolute = resolve(cwd);
	const absolute = resolve(cwdAbsolute, scanPath);
	const relativePath = relative(cwdAbsolute, absolute).replaceAll("\\", "/");
	const inCwd =
		absolute === cwdAbsolute ||
		absolute.startsWith(cwdAbsolute === sep ? sep : `${cwdAbsolute}${sep}`);
	const ignoreTargets = getIgnoreTargets(relativePath, inCwd);

	return {
		absolute,
		relativePath,
		ignoreTargets,
		inCwd,
	};
}

function getIgnoreTargets(path: string, inCwd: boolean): string[] {
	if (inCwd) return [path];

	const normalized = path.replace(LEADING_PARENT_SEGMENTS, "");
	const segments = normalized.split("/").filter(Boolean);
	if (segments.length === 0) return [normalized];

	const targets = new Set<string>([normalized]);
	for (let i = 1; i < segments.length; i++) {
		targets.add(segments.slice(i).join("/"));
	}

	return [...targets];
}
