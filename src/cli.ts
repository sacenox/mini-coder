import process from "node:process";
import type {
  Api,
  AssistantMessage,
  Message,
  Model,
  Models,
  ThinkingLevel,
  Tool,
  UserMessage,
} from "@earendil-works/pi-ai";
import { loadConfig, resolveModel, type ToolName } from "./config.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { toolSchemas } from "./tools/index.ts";
import { Session } from "./session.ts";
import { NO_INTERACTION, runAgentTurn } from "./agent.ts";
import { runTui } from "./tui/tui.ts";

interface RunContext {
  models: Models;
  model: Model<Api>;
  systemPrompt: string;
  tools: Tool[];
  toolNames: ToolName[];
  thinkingEffort: ThinkingLevel;
  session: Session;
}

function parseArgs(argv: string[]): { print: string | null } {
  let print: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-p" || arg === "--print") {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a prompt`);
      print = value;
    } else if (arg.startsWith("--print=")) {
      print = arg.slice("--print=".length);
    } else if (arg.startsWith("-p=")) {
      print = arg.slice("-p=".length);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { print };
}

async function runPrint(prompt: string, ctx: RunContext): Promise<number> {
  const messages: Message[] = [];
  const user: UserMessage = { role: "user", content: prompt, timestamp: Date.now() };
  messages.push(user);
  ctx.session.appendMessage(user);

  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  let failed = false;
  let cancelled = false;
  try {
    await runAgentTurn({
      ...ctx,
      messages,
      signal: controller.signal,
      interaction: NO_INTERACTION,
      onEvent: (event) => {
        if (event.type === "toolCall") process.stderr.write(`[tool] ${event.name}\n`);
        else if (event.type === "toolOutput") process.stderr.write(event.chunk);
        else if (event.type === "error") {
          failed = true;
          process.stderr.write(`[error] ${event.message}\n`);
        } else if (event.type === "cancelled") {
          cancelled = true;
          process.stderr.write("[cancelled]\n");
        }
      },
    });
  } catch (error) {
    failed = true;
    process.stderr.write(`[error] ${(error as Error).message}\n`);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    ctx.session.close();
  }

  const last = messages.filter((message): message is AssistantMessage => message.role === "assistant").at(-1);
  if (!failed && !cancelled && last !== undefined) {
    const text = last.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (text !== "") process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
  }
  return failed || cancelled ? 1 : 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const { models, model } = resolveModel(config);
  const session = new Session(config.sessionsDir, process.cwd());
  const ctx: RunContext = {
    models,
    model,
    systemPrompt: buildSystemPrompt(config),
    tools: toolSchemas(config.tools),
    toolNames: config.tools,
    thinkingEffort: config.thinkingEffort,
    session,
  };

  if (args.print !== null) {
    process.exitCode = await runPrint(args.print, ctx);
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("interactive mode requires a TTY; use -p for non-interactive mode");
  }
  await runTui(ctx);
}

main().catch((error) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
});
