import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

type ContextCandidate = { abs: string; label: string };

const HOME = homedir();

function tilde(p: string): string {
  return p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p;
}

/** Global context file candidates (home directory). */
function globalContextCandidates(homeDir: string = HOME): ContextCandidate[] {
  return [
    {
      abs: join(homeDir, ".agents", "AGENTS.md"),
      label: "~/.agents/AGENTS.md",
    },
    {
      abs: join(homeDir, ".agents", "CLAUDE.md"),
      label: "~/.agents/CLAUDE.md",
    },
    {
      abs: join(homeDir, ".claude", "CLAUDE.md"),
      label: "~/.claude/CLAUDE.md",
    },
  ];
}

/** Local context file candidates for a single directory. */
function dirContextCandidates(dir: string): ContextCandidate[] {
  const rel = (p: string) => tilde(resolve(dir, p));
  return [
    {
      abs: join(dir, ".agents", "AGENTS.md"),
      label: `${rel(".agents/AGENTS.md")}`,
    },
    {
      abs: join(dir, ".agents", "CLAUDE.md"),
      label: `${rel(".agents/CLAUDE.md")}`,
    },
    {
      abs: join(dir, ".claude", "CLAUDE.md"),
      label: `${rel(".claude/CLAUDE.md")}`,
    },
    { abs: join(dir, "CLAUDE.md"), label: `${rel("CLAUDE.md")}` },
    { abs: join(dir, "AGENTS.md"), label: `${rel("AGENTS.md")}` },
  ];
}

function existingCandidates(
  candidates: ContextCandidate[],
): ContextCandidate[] {
  return candidates.filter((candidate) => existsSync(candidate.abs));
}

function nearestLocalContextCandidates(cwd: string): ContextCandidate[] {
  let current = resolve(cwd);
  while (true) {
    const matches = existingCandidates(dirContextCandidates(current));
    if (matches.length > 0) return matches;
    if (existsSync(join(current, ".git"))) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return [];
}

/**
 * Active context file labels: global files plus the nearest local context
 * directory between cwd and the git root.
 */
export function discoverContextFiles(cwd: string, homeDir?: string): string[] {
  return [
    ...existingCandidates(globalContextCandidates(homeDir)).map((c) => c.label),
    ...nearestLocalContextCandidates(cwd).map((c) => c.label),
  ];
}

// ─── Content loading (for system prompt) ─────────────────────────────────────

function tryReadFile(p: string): string | null {
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

function readCandidates(candidates: ContextCandidate[]): string | null {
  const parts: string[] = [];
  for (const c of candidates) {
    const content = tryReadFile(c.abs);
    if (content) parts.push(content);
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

export function loadGlobalContextFile(homeDir?: string): string | null {
  return readCandidates(globalContextCandidates(homeDir));
}

/**
 * Walk from cwd up to the git root (or filesystem root),
 * returning content from the nearest directory with context files.
 */
export function loadLocalContextFile(cwd: string): string | null {
  return readCandidates(nearestLocalContextCandidates(cwd));
}
