import { basename } from "node:path";
import simpleGit from "simple-git";
import { handleArgv } from "./args.ts";
import { streamHeadless } from "./headless.ts";
import { initTUI } from "./tui.ts";
import type { TUIState } from "./types.ts";

export async function main(): Promise<void> {
  const cwd = basename(process.cwd());
  const options = await handleArgv(process.argv.slice(2));

  function leave(msg?: string) {
    if (msg) console.log(msg);
    process.exit(0);
  }

  if (options.prompt) {
    await streamHeadless(options, leave);
    process.exit(0);
  }

  const state: TUIState = {
    options,
    prompt: "",
    messages: [],
    streaming: false,
    stickToBottom: true,
    scrollOffset: 0,
    cwd,
  };

  const git = simpleGit();
  try {
    const gitStatus = (await git.status()).isClean() ? "" : "*";
    const gitBranch = (await git.branch()).current;
    state.gitBranch = `${gitBranch}${gitStatus}`;
  } catch (_) {} // No git

  initTUI(state, leave);
}
