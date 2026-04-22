import type { Message } from "@mariozechner/pi-ai";
import { streamAgent, TASK_PROMPT } from "./agent";
import { getApiKey } from "./oauth";
import { bash, runBashTool } from "./tool-bash";
import type { CliOptions, ToolAndRunner } from "./types";

export async function streamHeadless(
  options: CliOptions,
  leave: (s: string) => void,
) {
  const apiKey = await getApiKey(options);
  const tools: ToolAndRunner[] = [{ tool: bash, runner: runBashTool }];
  const messages: Message[] = [
    { role: "user", content: options.prompt || "", timestamp: Date.now() },
  ];

  console.log("mini-coder headless");
  console.log("-------------------");

  await streamAgent(
    apiKey,
    tools,
    TASK_PROMPT,
    messages,
    options,
    (ev) => {
      switch (ev.type) {
        case "text_start":
          console.log("> Answering...");
          break;
        case "thinking_start":
          console.log("> Thinking...");
          break;
        case "toolcall_start":
          console.log(`> Calling tool...`);
          break;
        case "toolcall_end":
          console.log(
            `> ${ev.toolCall.name}: ${ev.toolCall.arguments.command}`,
          );
          break;
        case "error":
          console.log(`Error ${ev.reason}\n${ev.error.content}`);
          break;
      }
    },
    undefined,
    (msg, _, dur) => {
      const text = msg.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      console.log(`\n${text}`);
      console.log(
        `\nTotal tokens: ${msg.usage.input} in, ${msg.usage.output} out`,
      );
      console.log(`Cost: $${msg.usage.cost.total.toFixed(4)}`);

      if (["stop", "error", "aborted"].includes(msg.stopReason)) {
        console.log(`Reason for stopping: "${msg.stopReason}"`);
        leave(`Done. Took ${dur / 1000}s`);
      }
    },
  );

  leave("Done.");
}
