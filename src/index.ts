import { basename } from "node:path";
import { handleArgv, validateArgv } from "./args.ts";
import { getBranchLabel } from "./git.ts";
import { streamHeadless } from "./headless.ts";
import { initTUI } from "./tui.ts";
import type { TUIState } from "./types.ts";
import { updateMiniCoder } from "./update.ts";

function isHeadlessInvocation(argv: string[]): boolean {
  return argv.includes("--prompt") || argv.includes("-p");
}

function requireInteractiveTerminal(): void {
  if (process.stdin.isTTY === true && process.stdout.isTTY === true) {
    return;
  }

  throw new Error(
    "Interactive mode requires a TTY on stdin and stdout. Use --prompt or -p for headless mode.",
  );
}

export async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  validateArgv(argv);

  if (argv.includes("--update")) {
    await updateMiniCoder();
    return;
  }

  if (!isHeadlessInvocation(argv)) {
    requireInteractiveTerminal();
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
