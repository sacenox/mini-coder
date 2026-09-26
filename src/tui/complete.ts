import { readdirSync, statSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Deliberately bash-unfaithful: no `cdable_vars`, no `~user` expansion (`~`
 * always means `homedir()`), no `$VAR`, backtick, or history expansion (word
 * text is always literal), and no shell options — dotfile hiding, byte-exact
 * matching, and dir-slash behavior below hold unconditionally.
 */

/**
 * A word must already carry path syntax to be completed: a leading `~`, a
 * leading `./` or `../` (or bare `.` / `..`), a leading `/`, or any segment
 * followed by a slash somewhere in the word. Bare words (`re`, `hello`) return
 * null without a syscall, so mid-sentence prose never gets hijacked.
 */
const PATH_LIKE = /^(?:~|\/|\.{1,2}(?:\/|$)|\w+\/)/;

/** A directory, or a symlink that resolves to one (`statSync` follows). */
function isDir(path: string, entry: Dirent): boolean {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return statSync(join(path, entry.name)).isDirectory();
  } catch {
    return false; // broken link completes file-shaped, like bash.
  }
}

/**
 * Completes `word` as a file path, bash-readline-style: the returned word is
 * the whole feedback, a strict extension of what was typed. Unreadable
 * locations, paths through files, and nothing longer to add all give null and
 * the caller leaves the draft alone.
 */
export function completePath(word: string, cwd: string): string | null {
  if (!PATH_LIKE.test(word)) return null;

  // Word = dirPart + prefix, split at the last slash, slash kept with dirPart.
  const slash = word.lastIndexOf("/");
  const prefix = word.slice(slash + 1);

  // Resolve dirPart to the directory to list. `~` means homedir() here and
  // nowhere else: the returned word below reuses the user's shorthand verbatim
  // (`~/Doc⇥` stays `~/Documents/`), so this resolve only locates the listing.
  // Concatenate before resolving — `resolve(home, "/x")` would reset to root.
  let dir: string;
  if (word.startsWith("~")) dir = resolve(homedir() + word.slice(1, slash));
  else if (slash === 0) dir = "/";
  else dir = resolve(cwd, word.slice(0, slash));

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null; // vanished, permission, or a file in the path: nothing better.
  }

  // Bash hides dotfiles unless the prefix itself starts with one (`~/.⇥`
  // includes hidden entries). A directory completion grows a trailing `/` so
  // the next Tab descends into it; a symlink to a directory counts as one —
  // `withFileTypes` reports the link itself, so the target needs one stat.
  const candidates = entries
    .filter((entry) => entry.name.startsWith(prefix) && (prefix.startsWith(".") || !entry.name.startsWith(".")))
    .map((entry) => (isDir(dir, entry) ? `${entry.name}/` : entry.name));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    // Worth returning only when it adds something the user did not already
    // type (`renameTag` typed against the single file match `renameTag` → null).
    return candidates[0] === prefix ? null : word.slice(0, word.length - prefix.length) + candidates[0];
  }
  const shared = candidates.reduce(commonPrefix);
  // Recombine over the untouched dirPart, so `~/Doc⇥` becomes `~/Documents/`
  // and never `/home/xonecas/Documents/`; no exact-name short-circuit here.
  return shared.length > prefix.length ? word.slice(0, word.length - prefix.length) + shared : null;
}

/** Case-sensitive longest common prefix; commands.ts uses it for command
 *  completion, completePath for path candidates. */
export function commonPrefix(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
}
