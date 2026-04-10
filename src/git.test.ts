import { describe, expect, test } from "bun:test";
import { getGitState, parseGitAheadBehind, parseGitStatus } from "./git.ts";

describe("parseGitStatus", () => {
  test("returns zero counts for empty output", () => {
    expect(parseGitStatus("")).toEqual({
      staged: 0,
      modified: 0,
      untracked: 0,
    });
  });

  test("counts mixed porcelain states", () => {
    expect(
      parseGitStatus(
        [
          "M  staged-only.txt",
          " M modified-only.txt",
          "MM staged-and-modified.txt",
          "?? new-file.txt",
        ].join("\n"),
      ),
    ).toEqual({
      staged: 2,
      modified: 2,
      untracked: 1,
    });
  });

  test("treats rename and delete statuses as tracked changes", () => {
    expect(
      parseGitStatus(
        [
          "R  renamed.txt -> renamed-again.txt",
          " D deleted.txt",
          "A  added.txt",
        ].join("\n"),
      ),
    ).toEqual({
      staged: 2,
      modified: 1,
      untracked: 0,
    });
  });
});

describe("parseGitAheadBehind", () => {
  test("parses ahead and behind counts from rev-list output", () => {
    expect(parseGitAheadBehind("3\t2")).toEqual({ ahead: 3, behind: 2 });
  });

  test("defaults missing or invalid values to zero", () => {
    expect(parseGitAheadBehind("")).toEqual({ ahead: 0, behind: 0 });
    expect(parseGitAheadBehind("nope nope")).toEqual({ ahead: 0, behind: 0 });
    expect(parseGitAheadBehind("5")).toEqual({ ahead: 5, behind: 0 });
  });
});

describe("getGitState", () => {
  test("returns null when git reports the cwd is not in a repo", async () => {
    const state = await getGitState("/tmp/not-a-repo", {
      run: async (args) => {
        expect(args).toEqual(["rev-parse", "--show-toplevel"]);
        return null;
      },
    });

    expect(state).toBeNull();
  });

  test("builds git state by parsing command output", async () => {
    const calls: Array<{ args: string[]; cwd: string; trim: boolean }> = [];
    const responses = new Map<string, string | null>([
      ["rev-parse --show-toplevel", "/repo"],
      ["branch --show-current", "main"],
      [
        "rev-parse --abbrev-ref --symbolic-full-name @{upstream}",
        "origin/main",
      ],
      [
        "status --porcelain",
        [
          "M  staged-only.txt",
          " M modified-only.txt",
          "MM staged-and-modified.txt",
          "?? new-file.txt",
        ].join("\n"),
      ],
      ["rev-list --left-right --count HEAD...@{upstream}", "4\t1"],
    ]);

    const state = await getGitState("/repo/subdir", {
      run: async (args, cwd, trim = true) => {
        calls.push({ args, cwd, trim });
        const key = args.join(" ");
        if (!responses.has(key)) {
          throw new Error(`Unexpected git command: ${key}`);
        }
        return responses.get(key) ?? null;
      },
    });

    expect(state).toEqual({
      root: "/repo",
      branch: "main",
      upstream: "origin/main",
      staged: 2,
      modified: 2,
      untracked: 1,
      ahead: 4,
      behind: 1,
    });
    expect(calls).toEqual([
      {
        args: ["rev-parse", "--show-toplevel"],
        cwd: "/repo/subdir",
        trim: true,
      },
      {
        args: ["branch", "--show-current"],
        cwd: "/repo/subdir",
        trim: true,
      },
      {
        args: [
          "rev-parse",
          "--abbrev-ref",
          "--symbolic-full-name",
          "@{upstream}",
        ],
        cwd: "/repo/subdir",
        trim: true,
      },
      {
        args: ["status", "--porcelain"],
        cwd: "/repo/subdir",
        trim: false,
      },
      {
        args: ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        cwd: "/repo/subdir",
        trim: true,
      },
    ]);
  });

  test("falls back to empty branch, null upstream, and zero counts when optional commands fail", async () => {
    const state = await getGitState("/repo", {
      run: async (args) => {
        const key = args.join(" ");
        switch (key) {
          case "rev-parse --show-toplevel":
            return "/repo";
          case "branch --show-current":
            return null;
          case "rev-parse --abbrev-ref --symbolic-full-name @{upstream}":
            return null;
          case "status --porcelain":
            return null;
          case "rev-list --left-right --count HEAD...@{upstream}":
            return null;
          default:
            throw new Error(`Unexpected git command: ${key}`);
        }
      },
    });

    expect(state).toEqual({
      root: "/repo",
      branch: "",
      upstream: null,
      staged: 0,
      modified: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
    });
  });
});
