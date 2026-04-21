import { getOAuthApiKey } from "@mariozechner/pi-ai/oauth";
import { handleArgv } from "./args.ts";
import { initTUI } from "./tui.ts";

export async function main(): Promise<void> {
  const options = await handleArgv(process.argv.slice(2));
  let apiKeys = {};

  console.log(options);

  if (options.prompt) {
    // TODO: Headless mode/non-interactiv
    process.exit(0);
  }

  initTUI({
    onStop: () => {
      console.log("Done.");
      process.exit(0);
    },
  });
}
