import { handleArgv } from "./args.ts";
import { streamHeadless } from "./headless.ts";
import { initTUI } from "./tui.ts";
import type { TUIActiveState, TUIState } from "./types.ts";

export async function main(): Promise<void> {
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
    activeState: "idle" as TUIActiveState,
    streaming: false,
    stickToBottom: true,
    scrollOffset: 0,
  };

  initTUI(state, leave);
}
