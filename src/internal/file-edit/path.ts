import { homedir } from "node:os";
import { join, relative } from "node:path";

function stripMatchingQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value.at(-1);
  if ((first === '"' || first === "'") && first === last) {
    return value.slice(1, -1);
  }
  return value;
}

function normalizePathInput(pathInput: string): string {
  return stripMatchingQuotes(pathInput.trim());
}

interface ResolvedPath {
  cwd: string;
  filePath: string;
  relPath: string;
}

export function resolvePath(
  cwdInput: string | undefined,
  pathInput: string,
): ResolvedPath {
  const cwd = cwdInput ?? process.cwd();
  const normalizedInput = normalizePathInput(pathInput);
  let expanded = normalizedInput;
  if (normalizedInput.startsWith("~/"))
    expanded = join(homedir(), normalizedInput.slice(2));
  else if (normalizedInput === "~") expanded = homedir();
  const filePath = expanded.startsWith("/") ? expanded : join(cwd, expanded);

  const relPath = relative(cwd, filePath);
  return { cwd, filePath, relPath };
}
