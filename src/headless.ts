import {
  type Context,
  completeSimple,
  streamSimple,
  type Tool,
} from "@mariozechner/pi-ai";
import { TASK_PROMPT } from "./agent";
import { getApiKey } from "./oauth";
import { bash, runBashTool } from "./tool-bash";
import type { CliOptions } from "./types";

export async function streamHeadless(
  options: CliOptions,
  leave: (s: string) => void,
) {
  const apiKey = await getApiKey(options);
  const tools: Tool[] = [bash];
  const context: Context = {
    systemPrompt: TASK_PROMPT,
    messages: [
      { content: options.prompt ?? "", role: "user", timestamp: Date.now() },
    ],
    tools,
  };

  console.log("mini-coder headless");
  console.log("-------------------");

  while (true) {
    const s = streamSimple(options.model, context, {
      apiKey,
      reasoning: options.effort,
    });

    for await (const ev of s) {
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
          console.log(`Error ${ev.error}`);
          break;
      }
    }

    const finalMessage = await s.result();
    context.messages.push(finalMessage);
    const finalContent = finalMessage.content
      .map((m) => m.type === "text" && m.text)
      .filter((m) => Boolean(m));

    if (finalContent.length > 0) console.log(finalContent.join("\n"));

    const toolCalls = finalMessage.content.filter((b) => b.type === "toolCall");
    for (const call of toolCalls) {
      const result = await runBashTool(call.arguments.command);

      context.messages.push({
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: result }],
        isError: false,
        timestamp: Date.now(),
      });
    }

    if (toolCalls.length > 0) {
      const cont = await completeSimple(options.model, context);
      context.messages.push(cont);
    }

    console.log(
      `Total tokens: ${finalMessage.usage.input} in, ${finalMessage.usage.output} out`,
    );
    console.log(`Cost: $${finalMessage.usage.cost.total.toFixed(4)}`);

    if (["stop", "error", "aborted"].includes(finalMessage.stopReason)) {
      console.log(`Reason for stopping: "${finalMessage.stopReason}"`);
      const dur = Date.now() - context.messages[0].timestamp;
      leave(`Done. Took ${dur / 1000}s`);
    }
  }
}
