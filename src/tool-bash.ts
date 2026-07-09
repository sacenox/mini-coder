import { type Tool, Type } from "@earendil-works/pi-ai";
import {
  appendToolOutput,
  createToolOutputBuffer,
  renderToolOutput,
} from "./tool-output.ts";
import type { ToolRunnerEvent } from "./types";

const description = `Bash CLI tool

Execute shell commands on the user's environment.

- Chain commands **only** when failure should stop the flow. Avoid long chains, **2 to 3 maximum**.
- Avoid overly complex one-liners; readability matters.
- Quote filenames: use \`"$file"\` not \`$file\`.
- Be careful with spaces in filenames.

Commands run in: ${process.cwd()}
`;

export const bash: Tool = {
  name: "bash",
  description,
  parameters: Type.Object({
    command: Type.String({
      description:
        "Shell command to execute. Prefer simple, focused commands over complex one-liners.",
    }),
  }),
};

export async function* runBashTool(
  args: Record<string, any>,
  signal?: AbortSignal,
): AsyncGenerator<ToolRunnerEvent> {
  // Redirect stderr into stdout for the whole shell session.
  const proc = Bun.spawn(["bash", "-c", `exec 2>&1; ${args.command}`], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      NO_COLOR: "1",
    },
    signal,
  });

  const decoder = new TextDecoder();
  const reader = proc.stdout.getReader();

  const output = createToolOutputBuffer();
  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      const remaining = Bun.stripANSI(decoder.decode());

      if (remaining.length) {
        const liveText = appendToolOutput(output, remaining);
        if (liveText) yield { type: "output", text: liveText };
      }
      break;
    }

    const text = Bun.stripANSI(decoder.decode(value, { stream: true }));

    if (text.length) {
      const liveText = appendToolOutput(output, text);
      if (liveText) yield { type: "output", text: liveText };
    }
  }

  const exitCode = await proc.exited;
  if (!renderToolOutput(output)) {
    appendToolOutput(output, "(no output)");
  }
  appendToolOutput(output, `\n\nExit code: ${exitCode}`);
  const result = renderToolOutput(output);

  yield {
    type: "result",
    text: result,
  };

  return result;
}
