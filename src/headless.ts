import type {
  AssistantMessage,
  AssistantMessageEvent,
  Message,
  ToolResultMessage,
} from "@mariozechner/pi-ai";
import { MAIN_PROMPT, streamAgent } from "./agent";
import { getApiKey } from "./oauth";
import { bash, runBashTool } from "./tool-bash";
import { edit, runEditTool } from "./tool-edit";
import { runTaskTool, task } from "./tool-task";
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
    { tool: task, runner: (args) => runTaskTool(options, args) },
  ];
  const messages: Message[] = [
    { role: "user", content: options.prompt || "", timestamp: Date.now() },
  ];

  function log(args: { msg?: string; json?: string }) {
    if ("json" in args && options.jsonOutput) console.log(args.json);
    if ("msg" in args && !options.jsonOutput) console.log(args.msg);
  }

  const onStream = (ev: AssistantMessageEvent) => {
    switch (ev.type) {
      case "text_end":
        log({ msg: `> ${ev.content}` });
        break;
      case "thinking_start":
        log({ msg: "> Thinking..." });
        break;
      case "toolcall_end":
        // TODO: other tools output
        log({
          msg: `> ${ev.toolCall.name}: ${JSON.stringify(ev.toolCall.arguments)}`,
        });
        break;
      case "error":
        log({ msg: `> Error ${ev.reason}\n${ev.error.content}` });
        break;
    }

    // Log all non-delta events:
    if (!ev.type.includes("delta")) {
      log({ json: JSON.stringify(ev) });
    }
  };

  const onTool = (tool: ToolResultMessage) => {
    let text = tool.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .slice(-400);

    if (text.length === 400) {
      text = `...${text}`;
    }

    log({
      msg: `> ${tool.toolName} output:\n---\n${text}\n---`,
      json: JSON.stringify(tool),
    });

    return tool;
  };

  const onComplete = (msg: AssistantMessage) => {
    log({
      msg: `\nTotal tokens: ${msg.usage.input} in, ${msg.usage.output} out`,
    });
    log({ msg: `Cost: $${msg.usage.cost.total.toFixed(4)}\n` });

    if (["stop", "error", "aborted"].includes(msg.stopReason)) {
      log({ msg: `Reason for stopping: "${msg.stopReason}"` });
      leave(
        !options.jsonOutput
          ? `Done. Took ${(Date.now() - lastTs) / 1000}s`
          : undefined,
      );
    }
  };

  log({ msg: "mini-coder headless" });
  log({ msg: "-------------------" });

  for await (const event of streamAgent(
    apiKey,
    tools,
    MAIN_PROMPT,
    messages,
    options,
    undefined,
  )) {
    switch (event.type) {
      case "assistant":
        onStream(event.event);
        break;

      case "tool_output":
        // TODO:
        //  onToolOutput(event);
        break;

      case "tool_result":
        onTool(event.message);
        break;

      case "complete":
        onComplete(event.message);
        break;
    }
  }

  leave("Done.");
}
