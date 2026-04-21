import { Context, stream } from "@mariozechner/pi-ai";
import { getApiKey } from "./oauth";
import type { CliOptions } from "./types";

export async function streamHeadless(options: CliOptions) {
  const apiKey = await getApiKey(options);
  const context: Context = {
    // TODO: Centralize prompts
    systemPrompt:
      "You are friendly coding assistant, answer user questions and complete given tasks with accuracy.",
    messages: [
      { content: options.prompt ?? "", role: "user", timestamp: Date.now() },
    ],
    tools: [],
  };

  const s = stream(options.model, context, { apiKey });
  for await (const ev of s) {
    switch (ev.type) {
      case "start":
        console.log("Starting headless mode");
        break;
      case "text_start":
        console.log("Answering...")
        break;
      case "thinking_start":
        console.log("Thinking... or trying to...")
        break;
      case "done":
        console.log("Done.")
        break;
      case "error":
        console.log(`Error ${ev.error}`)
        break;
    }
  }

  const finalMessage = await s.result();
  context.messages.push(finalMessage)
  console.log(finalMessage.content)
}
