import { spawn } from "node:child_process";
import { Type, type Static } from "@earendil-works/pi-ai";
import type { ToolContext, ToolResult } from "./common.ts";

export const BASH_PARAMS = Type.Object(
  { command: Type.String({ description: "Command to run" }) },
  { additionalProperties: false },
);
type BashArgs = Static<typeof BASH_PARAMS>;

const MAX_HEAD = 10_000;
const MAX_TAIL = 6_000;
const TRUNCATED = "\n\n... output truncated ...\n\n";

export function bash(args: BashArgs, ctx: ToolContext): Promise<ToolResult> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", args.command], {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let head = "";
    let tail = "";
    let omitted = 0;
    const append = (chunk: Buffer) => {
      let text = chunk.toString();
      ctx.onOutput?.(text);
      if (head.length < MAX_HEAD) {
        const take = Math.min(MAX_HEAD - head.length, text.length);
        head += text.slice(0, take);
        text = text.slice(take);
      }
      if (text === "") return;
      tail += text;
      if (tail.length > MAX_TAIL) {
        omitted += tail.length - MAX_TAIL;
        tail = tail.slice(tail.length - MAX_TAIL);
      }
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      ctx.signal.removeEventListener("abort", onAbort);
      clearTimeout(killTimer);
      const exit = code ?? (ctx.signal.aborted ? "aborted" : "unknown");
      const truncated = omitted > 0;
      const body = truncated ? head + TRUNCATED + tail : head + tail;
      const text = body + (body.endsWith("\n") || body === "" ? "" : "\n") + `exit code: ${exit}`;
      resolve({
        text,
        isError: code !== 0,
        details: truncated
          ? { truncated: true, omittedChars: omitted, totalChars: head.length + tail.length + omitted }
          : undefined,
      });
    };

    let killTimer: NodeJS.Timeout | undefined;
    const onAbort = () => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
      killTimer = setTimeout(() => {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          /* already gone */
        }
      }, 300);
    };

    if (ctx.signal.aborted) onAbort();
    else ctx.signal.addEventListener("abort", onAbort, { once: true });

    child.on("error", (error) => {
      append(Buffer.from(`${head || tail ? "\n" : ""}bash failed: ${error.message}\n`));
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}
