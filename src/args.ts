import { loginOAuth, readCreds } from "./oauth";
import type { CliOptions } from "./types.ts";

export async function handleArgv(argv: string[]): Promise<CliOptions> {
  // TODO: Fetch defaults from settings file
  let options: CliOptions = {
    model: "gpt-5.4",
    provider: "openai-codex",
    effort: "xhigh",
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];

    if (flag === "--prompt" || flag === "-p") {
      options = { ...options, prompt: argv[i + 1] };
    }

    if (flag === "--login" || flag === "-l") {
      await loginOAuth(argv[i + 1]);
    }
  }

  return options;
}
