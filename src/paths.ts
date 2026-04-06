/**
 * Filesystem path normalization helpers.
 *
 * Provides a small shared policy for path identity across the app:
 * when paths are used for comparison or persistence, we canonicalize them
 * to an absolute, symlink-resolved spelling.
 *
 * @module
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Return the canonical absolute path for an existing filesystem entry.
 *
 * Canonicalization resolves `.`/`..` segments and follows symlinks,
 * producing a stable spelling suitable for path equality checks and
 * persistence keys.
 *
 * @param path - An existing filesystem path.
 * @returns The canonical absolute path.
 */
export function canonicalizePath(path: string): string {
  return realpathSync(resolve(path));
}

/**
 * Check whether two paths refer to the same existing filesystem entry.
 *
 * @param a - The first path to compare.
 * @param b - The second path to compare.
 * @returns `true` when both paths resolve to the same canonical location.
 */
export function isSamePath(a: string, b: string): boolean {
  return canonicalizePath(a) === canonicalizePath(b);
}
