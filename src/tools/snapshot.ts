import { type Dirent, lstatSync, readFileSync, readdirSync, type Stats } from "node:fs";
import { join, relative } from "node:path";
import { createTwoFilesPatch } from "diff";
import type { FileDiff } from "./common.ts";

const MAX_FILE_BYTES = 1 << 20;
const MAX_TOTAL_BYTES = 32 << 20;
const BINARY_SNIFF = 8192;

const IGNORED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
]);

type Kind = "text" | "binary" | "large" | "link" | "untracked";

interface FileState {
  size: number;
  mtimeMs: number;
  ino: number;
  kind: Kind;
  content: string | null;
}

/** Relpath -> state. A shallow copy, safe against later captures. */
export type Tree = Map<string, FileState>;

interface Entry {
  rel: string;
  abs: string;
  size: number;
  mtimeMs: number;
  ino: number;
  link: boolean;
}

function* walk(): Generator<Entry> {
  const root = process.cwd();
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of entries) {
      const abs = join(dir, dirent.name);
      if (dirent.isDirectory()) {
        if (!IGNORED_DIRS.has(dirent.name)) stack.push(abs);
        continue;
      }
      const link = dirent.isSymbolicLink();
      if (!link && !dirent.isFile()) continue;
      let stat: Stats;
      try {
        stat = lstatSync(abs);
      } catch {
        continue;
      }
      yield { rel: relative(root, abs), abs, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino, link };
    }
  }
}

function build(entry: Entry, overBudget: boolean): FileState {
  const base = { size: entry.size, mtimeMs: entry.mtimeMs, ino: entry.ino };
  if (entry.size > MAX_FILE_BYTES) return { ...base, kind: "large", content: null };
  if (overBudget) return { ...base, kind: "untracked", content: null };
  let buffer;
  try {
    buffer = readFileSync(entry.abs);
  } catch {
    return { ...base, kind: "untracked", content: null };
  }
  if (buffer.subarray(0, BINARY_SNIFF).includes(0)) return { ...base, kind: "binary", content: null };
  return { ...base, kind: "text", content: buffer.toString("utf8") };
}

type StatKey = Pick<FileState, "size" | "mtimeMs" | "ino">;

function sameStat(a: StatKey, b: StatKey): boolean {
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino;
}

/**
 * Caches file content across calls, keyed by the stat triple `(size, mtimeMs,
 * ino)`, so a second capture only reads what the stat walk shows as changed.
 */
class SnapshotCache {
  private cache = new Map<string, FileState>();

  capture(forceSinceMs?: number): Tree {
    const next: Tree = new Map();
    let total = 0;
    for (const entry of walk()) {
      const cached = this.cache.get(entry.rel);
      const forced = forceSinceMs !== undefined && entry.mtimeMs >= forceSinceMs;
      const reuse = !entry.link && !forced && cached !== undefined && sameStat(cached, entry);
      const state = reuse
        ? cached!
        : entry.link
          ? { size: entry.size, mtimeMs: entry.mtimeMs, ino: entry.ino, kind: "link" as const, content: null }
          : build(entry, total >= MAX_TOTAL_BYTES);
      if (state.content !== null) total += state.size;
      next.set(entry.rel, state);
    }
    this.cache = next;
    return new Map(next);
  }
}

let cache: SnapshotCache | undefined;

/** Captures the working tree, re-reading content only when its stat key moved. */
export function snapshot(forceSinceMs?: number): Tree {
  cache ??= new SnapshotCache();
  return cache.capture(forceSinceMs);
}

function patch(path: string, before: string, after: string): string {
  return createTwoFilesPatch(path, path, before, after, "", "", { context: 3 });
}

function noteFor(kind: Kind, verb: string): string {
  if (kind === "binary") return `binary file ${verb}`;
  if (kind === "large") return `large file ${verb}`;
  return `file not tracked (${verb})`;
}

function diffOne(path: string, before: FileState | undefined, after: FileState | undefined): FileDiff | null {
  if (before === undefined) {
    if (after!.kind === "link") return { path, note: "symlink created" };
    return after!.content === null
      ? { path, note: noteFor(after!.kind, "created") }
      : { path, patch: patch(path, "", after!.content) };
  }
  if (after === undefined) {
    if (before.kind === "link") return { path, note: "symlink removed" };
    return before.content === null
      ? { path, note: noteFor(before.kind, "deleted") }
      : { path, patch: patch(path, before.content, "") };
  }
  if (before.kind === "link" || after.kind === "link") {
    return sameStat(before, after) ? null : { path, note: "symlink changed" };
  }
  if (before.content !== null && after.content !== null) {
    return before.content === after.content ? null : { path, patch: patch(path, before.content, after.content) };
  }
  if (sameStat(before, after)) return null;
  return { path, note: noteFor(after.content === null ? after.kind : before.kind, "changed") };
}

/** The files that differ between two captures, sorted for stable output. */
export function diffTrees(before: Tree, after: Tree): FileDiff[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  const diffs: FileDiff[] = [];
  for (const path of [...paths].sort()) {
    const diff = diffOne(path, before.get(path), after.get(path));
    if (diff !== null) diffs.push(diff);
  }
  return diffs;
}
