import * as c from "yoctocolors";
import { select } from "yoctoselect";
import { listSessions } from "../session/db/index.ts";
import { setStdinGated } from "./input.ts";
import { PREFIX, tildePath, writeln } from "./output.ts";
import type { CommandContext } from "./types.ts";

export async function handleSessionCommand(
  ctx: CommandContext,
  args: string,
): Promise<void> {
  const id = args.trim();
  if (id) {
    ctx.startSpinner("switching session");
    const ok = await ctx.switchSession(id);
    ctx.stopSpinner();
    if (ok) {
      writeln(
        `${PREFIX.success} switched to session ${c.cyan(id)} (${c.cyan(ctx.currentModel)})`,
      );
    } else {
      writeln(`${PREFIX.error} session ${c.cyan(id)} not found`);
    }
    return;
  }

  const sessions = listSessions(50);
  if (sessions.length === 0) {
    writeln(`${PREFIX.info} ${c.dim("no sessions found")}`);
    return;
  }

  const items = sessions.map((s) => {
    const title = s.title || "(untitled)";
    const model = s.model.split("/").pop() ?? s.model;
    const cwd = tildePath(s.cwd);
    const date = new Date(s.updated_at).toLocaleDateString();
    return {
      label: `${c.dim(s.id)}  ${title}  ${c.cyan(model)}  ${c.dim(cwd)}  ${c.dim(date)}`,
      value: s.id,
      filterText: `${s.id} ${s.title} ${s.model} ${s.cwd}`,
    };
  });

  setStdinGated(true);
  let picked: string | null;
  try {
    picked = await select({ items, placeholder: "search sessions..." });
  } finally {
    setStdinGated(false);
  }
  if (!picked) return;

  const ok = await ctx.switchSession(picked);
  if (ok) {
    writeln(
      `${PREFIX.success} switched to session ${c.cyan(picked)} (${c.cyan(ctx.currentModel)})`,
    );
  } else {
    writeln(`${PREFIX.error} session ${c.cyan(picked)} not found`);
  }
}
