import { handleArgv } from "./args.ts";
import { streamHeadless } from "./headless.ts";
import { initTUI } from "./tui.ts";

export async function main(): Promise<void> {
  const options = await handleArgv(process.argv.slice(2));

  console.log(options);

  if (options.prompt) {
    // TODO: Headless mode/non-interactiv
    await streamHeadless(options);
    process.exit(0);
  }

  initTUI({
    onStop: () => {
      console.log("Done.");
      process.exit(0);
    },
  });
}
