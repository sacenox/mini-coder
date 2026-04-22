import { complete, Context, stream, Tool, Type } from "@mariozechner/pi-ai";
import { getApiKey } from "./oauth";
import type { CliOptions } from "./types";

export async function streamHeadless(
  options: CliOptions,
  leave: (s: string) => void,
) {
  const apiKey = await getApiKey(options);

  const tools: Tool[] = [
    {
      name: "bash",
      description:
        "This is your command line, runs commands in your user's environment.",
      parameters: Type.Object({
        command: Type.String({
          description:
            "The command you want to run, ex: `ls`, `fd`, `find`, `grep`, `rg`, `cat`, `sed`, `bun`, etc",
        }),
      }),
    },
  ];

  const context: Context = {
    // TODO: Centralize prompts
    systemPrompt:
      "You are friendly coding assistant, answer user questions and complete given tasks with accuracy.",
    messages: [
      { content: options.prompt ?? "", role: "user", timestamp: Date.now() },
    ],
    tools,
  };

  console.log("mini-coder headless");
  console.log("-------------------");

  while (true) {
    const s = stream(options.model, context, {
      apiKey,
      reasoning: options.effort,
    });

    for await (const ev of s) {
      switch (ev.type) {
        case "text_start":
          console.log("Answering...");
          break;
        case "thinking_start":
          console.log("Thinking...");
          break;
        case "toolcall_start":
          console.log(`Calling tool...`);
          break;
        case "toolcall_end":
          console.log(
            `${ev.toolCall.name}:\n\t${ev.toolCall.arguments.command}`,
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
      const proc = Bun.spawn(["bash", "-c", call.arguments.command]);
      await proc.exited;
      const result = await proc.stdout.text();

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
      const cont = await complete(options.model, context);
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
