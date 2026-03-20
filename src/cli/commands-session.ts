import * as c from "yoctocolors";
import { renderSessionTable } from "../session/manager.ts";
import { PREFIX, writeln } from "./output.ts";
import type { CommandContext } from "./types.ts";

export function handleSessionCommand(ctx: CommandContext, args: string): void {
  const id = args.trim();
  if (id) {
    ctx.startSpinner("switching session");
    const ok = ctx.switchSession(id);
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

  const shown = renderSessionTable(
    `${c.dim("Use")} /session <id> ${c.dim("to switch to a session.")}`,
  );
  if (!shown) {
    writeln(`${PREFIX.info} ${c.dim("no sessions found")}`);
  }
}
