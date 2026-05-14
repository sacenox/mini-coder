import simpleGit from "simple-git";

const git = simpleGit();

export async function getGitStatus() {
  try {
    const status = await git.status();
    return status;
  } catch (_) {
    return { nogit: "No git repo in this folder." };
  } // No git
}

export async function getBranchLabel() {
  try {
    const status = await git.status();
    const isClean = status.isClean();

    return `${status.current}${isClean ? "" : "*"}`;
  } catch (_) {
    return "No git";
  } // No git
}
