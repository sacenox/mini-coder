import { basename } from "node:path";
import { handleArgv } from "./args.ts";
import { getBranchLabel } from "./git.ts";
import { streamHeadless } from "./headless.ts";
import { initTUI } from "./tui.ts";
import type { TUIState } from "./types.ts";
import { updateMiniCoder } from "./update.ts";

export async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("--update")) {
    await updateMiniCoder();
    return;
  }

  const cwd = basename(process.cwd());
  const options = await handleArgv(argv);

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
    tuiMessages: [],
    streaming: false,
    stickToBottom: true,
    scrollOffset: 0,
    cwd,
    gitBranch: await getBranchLabel(),
  };

  initTUI(state, leave);
}
