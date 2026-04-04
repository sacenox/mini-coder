import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getGitState } from "./git.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mc-git-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Run a git command in the temp directory. */
async function git(args: string, cwd = tmp): Promise<string> {
  const proc = Bun.spawn(["git", ...args.split(" ")], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@test.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@test.com",
    },
  });
  const out = await new Response(proc.stdout as ReadableStream).text();
  await proc.exited;
  return out.trim();
}

/** Initialize a git repo with one commit so HEAD exists. */
async function initRepo(cwd = tmp): Promise<void> {
  await git("init", cwd);
  writeFileSync(join(cwd, "README.md"), "# init\n");
  await git("add .", cwd);
  await git("commit -m init", cwd);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getGitState", () => {
  test("returns null outside a git repo", async () => {
    const state = await getGitState(tmp);
    expect(state).toBeNull();
  });

  test("detects repo root", async () => {
    await initRepo();
    const state = await getGitState(tmp);
    expect(state).not.toBeNull();
    expect(state!.root).toBe(resolve(tmp));
  });

  test("gets current branch name", async () => {
    await initRepo();
    const state = await getGitState(tmp);
    expect(state!.branch).toBeOneOf(["main", "master"]);
  });

  test("counts untracked files", async () => {
    await initRepo();
    writeFileSync(join(tmp, "new.txt"), "untracked");
    const state = await getGitState(tmp);
    expect(state!.untracked).toBe(1);
  });

  test("counts modified files", async () => {
    await initRepo();
    writeFileSync(join(tmp, "README.md"), "modified\n");
    const state = await getGitState(tmp);
    expect(state!.modified).toBe(1);
  });

  test("counts staged files", async () => {
    await initRepo();
    writeFileSync(join(tmp, "README.md"), "staged\n");
    await git("add README.md");
    const state = await getGitState(tmp);
    expect(state!.staged).toBe(1);
  });

  test("counts mixed states correctly", async () => {
    await initRepo();
    // Stage a change
    writeFileSync(join(tmp, "README.md"), "staged\n");
    await git("add README.md");
    // Add an untracked file
    writeFileSync(join(tmp, "new.txt"), "untracked");
    // Add a modified (but not staged) file — modify README again after staging
    writeFileSync(join(tmp, "README.md"), "staged then modified\n");

    const state = await getGitState(tmp);
    expect(state!.staged).toBe(1);
    expect(state!.modified).toBe(1);
    expect(state!.untracked).toBe(1);
  });

  test("returns zero ahead/behind when no upstream", async () => {
    await initRepo();
    const state = await getGitState(tmp);
    expect(state!.ahead).toBe(0);
    expect(state!.behind).toBe(0);
  });

  test("detects ahead count relative to upstream", async () => {
    // Create a bare "remote" repo
    const bare = join(tmp, "remote.git");
    await git(`init --bare ${bare}`);

    // Init a working repo and push
    const work = join(tmp, "work");
    await git(`clone ${bare} ${work}`);
    writeFileSync(join(work, "file.txt"), "initial\n");
    await git("add .", work);
    await git("commit -m first", work);
    await git("push origin HEAD", work);

    // Make a local commit (ahead by 1)
    writeFileSync(join(work, "file.txt"), "updated\n");
    await git("add .", work);
    await git("commit -m second", work);

    const state = await getGitState(work);
    expect(state!.ahead).toBe(1);
    expect(state!.behind).toBe(0);
  });

  test("works from a subdirectory", async () => {
    await initRepo();
    const sub = join(tmp, "src", "deep");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(sub, { recursive: true });

    const state = await getGitState(sub);
    expect(state).not.toBeNull();
    expect(state!.root).toBe(resolve(tmp));
  });
});
