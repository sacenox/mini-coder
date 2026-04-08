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
function parseStatus(output: string): {
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Gather the current git state for a directory.
 *
 * Runs several fast git commands in parallel to collect branch, working
 * tree status, and ahead/behind counts. Returns `null` if the directory
 * is not inside a git repository.
 *
 * @param cwd - The directory to query (can be a subdirectory of the repo).
 * @returns A {@link GitState} snapshot, or `null` if not in a git repo.
 */
export async function getGitState(cwd: string): Promise<GitState | null> {
  // Check if we're in a repo and get the root
  const root = await run(["rev-parse", "--show-toplevel"], cwd);
  if (root === null) return null;

  // Run remaining commands in parallel
  const [branch, status, revList] = await Promise.all([
    run(["branch", "--show-current"], cwd),
    run(["status", "--porcelain"], cwd, false),
    run(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], cwd),
  ]);

  const { staged, modified, untracked } = parseStatus(status ?? "");

  // Parse ahead/behind from rev-list output (format: "ahead\tbehind")
  let ahead = 0;
  let behind = 0;
  if (revList) {
    const parts = revList.split(/\s+/);
    ahead = parseInt(parts[0] ?? "0", 10) || 0;
    behind = parseInt(parts[1] ?? "0", 10) || 0;
  }

  return {
    root,
    branch: branch ?? "",
    staged,
    modified,
    untracked,
    ahead,
    behind,
  };
}
