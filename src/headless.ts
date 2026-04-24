import type { Message } from "@mariozechner/pi-ai";
import { streamAgent, TASK_PROMPT } from "./agent";
import { getApiKey } from "./oauth";
import { bash, runBashTool } from "./tool-bash";
import { edit, runEditTool } from "./tool-edit";
import type { CliOptions, ToolAndRunner } from "./types";

export async function streamHeadless(
  options: CliOptions,
  leave: (s?: string) => void,
) {
  const lastTs = Date.now();
  const apiKey = await getApiKey(options);
  const tools: ToolAndRunner[] = [
    { tool: bash, runner: runBashTool },
    { tool: edit, runner: runEditTool },
  ];
  const messages: Message[] = [
    { role: "user", content: options.prompt || "", timestamp: Date.now() },
  ];

  function log(msg: string) {
    if (options.jsonOutput) return;
    console.log(msg);
  }

  log("mini-coder headless");
  log("-------------------");

  await streamAgent(
    apiKey,
    tools,
    TASK_PROMPT,
    messages,
    options,
    undefined,
    (ev) => {
      switch (ev.type) {
        case "text_start":
          log("> Answering...");
          break;
        case "thinking_start":
          log("> Thinking...");
          break;
        case "toolcall_end":
          log(`> ${ev.toolCall.name}: ${ev.toolCall.arguments.command}`);
          break;
        case "error":
          log(`Error ${ev.reason}\n${ev.error.content}`);
          break;
      }
    },
    undefined,
    (msg) => {
      const text = msg.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      log(`\n${text}`);
      log(`\nTotal tokens: ${msg.usage.input} in, ${msg.usage.output} out`);
      log(`Cost: $${msg.usage.cost.total.toFixed(4)}`);

      if (options.jsonOutput) {
        console.log(JSON.stringify(messages, null, 4));
      }

      if (["stop", "error", "aborted"].includes(msg.stopReason)) {
        log(`Reason for stopping: "${msg.stopReason}"`);
        leave(
          !options.jsonOutput
            ? `Done. Took ${(Date.now() - lastTs) / 1000}s`
            : undefined,
        );
      }
    },
  );

  leave("Done.");
}
