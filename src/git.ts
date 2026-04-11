/**
 * Git state gathering.
 *
 * Runs fast git commands to collect branch name, working tree counts,
 * and ahead/behind status. Used by the system prompt footer and the
 * status bar to give the model and user situational awareness.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Snapshot of the current git repository state.
 *
 * All counts are non-negative integers. When there is no upstream
 * tracking branch, `ahead` and `behind` are both `0`.
 */
export interface GitState {
  /** Absolute path to the repository root. */
  root: string;
  /** Current branch name (empty string for detached HEAD). */
  branch: string;
  /** Upstream tracking ref such as `origin/main`, or `null` when none exists. */
  upstream: string | null;
  /** Number of staged (index) changes. */
  staged: number;
  /** Number of unstaged working-tree modifications. */
  modified: number;
  /** Number of untracked files. */
  untracked: number;
  /** Commits ahead of the upstream tracking branch. */
  ahead: number;
  /** Commits behind the upstream tracking branch. */
  behind: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a git command and return its trimmed stdout.
 * Returns `null` if the command fails (non-zero exit).
 */
async function run(
  args: string[],
  cwd: string,
  trim = true,
): Promise<string | null> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout as ReadableStream).text();
  const code = await proc.exited;
  if (code !== 0) return null;
  return trim ? out.trim() : out;
}

function getErrorStringProperty(
  error: unknown,
  key: string,
): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const value = Reflect.get(error, key);
  return typeof value === "string" ? value : undefined;
}

function isMissingGitError(error: unknown): boolean {
  const code = getErrorStringProperty(error, "code");
  if (code !== "ENOENT") {
    return false;
  }

  const message = getErrorStringProperty(error, "message");
  return (
    typeof message === "string" &&
    message.includes('Executable not found in $PATH: "git"')
  );
}

async function safeRun(
  runGit: (
    args: string[],
    cwd: string,
    trim?: boolean,
  ) => Promise<string | null>,
  args: string[],
  cwd: string,
  trim = true,
): Promise<string | null> {
  try {
    return await runGit(args, cwd, trim);
  } catch (error) {
    if (isMissingGitError(error)) {
      return null;
    }
    throw error;
  }
}

function isUntrackedStatus(
  indexStatus: string,
  workingTreeStatus: string,
): boolean {
  return indexStatus === "?" && workingTreeStatus === "?";
}

function hasTrackedChange(status: string): boolean {
  return status !== " " && status !== "?";
}

/**
 * Parse `git status --porcelain` output into staged, modified, and untracked counts.
 *
 * Porcelain v1 format: two-character status code per line.
 * - Column 1 = index (staged) status
 * - Column 2 = working tree status
 * - `?` in both columns = untracked
 *
 * @param output - Raw `git status --porcelain` output.
 * @returns Counts of staged, modified, and untracked files.
 */
export function parseGitStatus(output: string): {
  staged: number;
  modified: number;
  untracked: number;
} {
  let staged = 0;
  let modified = 0;
  let untracked = 0;

  for (const line of output.split("\n")) {
    if (line.length < 2) {
      continue;
    }

    const indexStatus = line[0];
    const workingTreeStatus = line[1];
    if (!indexStatus || !workingTreeStatus) {
      continue;
    }
    if (isUntrackedStatus(indexStatus, workingTreeStatus)) {
      untracked++;
      continue;
    }
    if (hasTrackedChange(indexStatus)) {
      staged++;
    }
    if (hasTrackedChange(workingTreeStatus)) {
      modified++;
    }
  }

  return { staged, modified, untracked };
}

/**
 * Parse `git rev-list --left-right --count HEAD...@{upstream}` output.
 *
 * The command returns two whitespace-separated integers: ahead then behind.
 * Invalid or missing values are treated as `0`.
 *
 * @param output - Raw `git rev-list --left-right --count` output.
 * @returns Parsed ahead and behind counts.
 */
export function parseGitAheadBehind(output: string): {
  ahead: number;
  behind: number;
} {
  const parts = output.trim().split(/\s+/);
  return {
    ahead: parseInt(parts[0] ?? "0", 10) || 0,
    behind: parseInt(parts[1] ?? "0", 10) || 0,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Gather the current git state for a directory.
 *
 * Runs several fast git commands in parallel to collect branch, working
 * tree status, and ahead/behind counts. Returns `null` if git is not
 * installed or the directory is not inside a git repository.
 *
 * @param cwd - The directory to query (can be a subdirectory of the repo).
 * @param opts - Optional runtime overrides used by tests.
 * @returns A {@link GitState} snapshot, or `null` if not in a git repo.
 */
export async function getGitState(
  cwd: string,
  opts?: {
    run?: (
      args: string[],
      cwd: string,
      trim?: boolean,
    ) => Promise<string | null>;
  },
): Promise<GitState | null> {
  const exec = opts?.run ?? run;

  // Check if we're in a repo and get the root
  const root = await safeRun(exec, ["rev-parse", "--show-toplevel"], cwd);
  if (root === null) return null;

  // Run remaining commands in parallel
  const [branch, upstream, status, revList] = await Promise.all([
    safeRun(exec, ["branch", "--show-current"], cwd),
    safeRun(
      exec,
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      cwd,
    ),
    safeRun(exec, ["status", "--porcelain"], cwd, false),
    safeRun(
      exec,
      ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
      cwd,
    ),
  ]);

  const { staged, modified, untracked } = parseGitStatus(status ?? "");
  const { ahead, behind } = revList
    ? parseGitAheadBehind(revList)
    : { ahead: 0, behind: 0 };

  return {
    root,
    branch: branch ?? "",
    upstream,
    staged,
    modified,
    untracked,
    ahead,
    behind,
  };
}
