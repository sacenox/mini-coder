import { handleArgv } from "./args.ts";
import { streamHeadless } from "./headless.ts";
import { initTUI } from "./tui.ts";

function leave(msg: string) {
  console.log(msg);
  process.exit(0);
}

export async function main(): Promise<void> {
  const options = await handleArgv(process.argv.slice(2));

  if (options.prompt) {
    await streamHeadless(options, leave);
    process.exit(0);
  }

  initTUI({
    onStop: () => {
      leave("Done.");
    },
  });
}
