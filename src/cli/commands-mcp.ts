import * as c from "yoctocolors";
import {
	deleteMcpServer,
	listMcpServers,
	upsertMcpServer,
} from "../session/db/index.ts";
import { PREFIX, writeln } from "./output.ts";
import type { CommandContext } from "./types.ts";

export async function handleMcpCommand(
	ctx: CommandContext,
	args: string,
): Promise<void> {
	const parts = args.trim().split(/\s+/);
	const sub = parts[0] ?? "list";

	switch (sub) {
		case "list": {
			const servers = listMcpServers();
			if (servers.length === 0) {
				writeln(c.dim("  no MCP servers configured"));
				writeln(
					c.dim(
						"  /mcp add <name> http <url>  ·  /mcp add <name> stdio <cmd> [args...]",
					),
				);
				return;
			}
			writeln();
			for (const s of servers) {
				const detailText = s.url ?? s.command ?? "";
				const detail = detailText ? c.dim(`  ${detailText}`) : "";
				writeln(
					`  ${c.yellow("⚙")} ${c.bold(s.name)}  ${c.dim(s.transport)}${detail}`,
				);
			}
			return;
		}

		case "add": {
			const [, name, transport, ...rest] = parts;
			if (!name || !transport || rest.length === 0) {
				writeln(`${PREFIX.error} usage: /mcp add <name> http <url>`);
				writeln(`${PREFIX.error}        /mcp add <name> stdio <cmd> [args...]`);
				return;
			}
			if (transport === "http") {
				const url = rest[0];
				if (!url) {
					writeln(`${PREFIX.error} usage: /mcp add <name> http <url>`);
					return;
				}
				upsertMcpServer({
					name,
					transport,
					url,
					command: null,
					args: null,
					env: null,
				});
			} else if (transport === "stdio") {
				const [command, ...cmdArgs] = rest;
				if (!command) {
					writeln(
						`${PREFIX.error} usage: /mcp add <name> stdio <cmd> [args...]`,
					);
					return;
				}
				upsertMcpServer({
					name,
					transport,
					url: null,
					command,
					args: cmdArgs.length ? JSON.stringify(cmdArgs) : null,
					env: null,
				});
			} else {
				writeln(
					`${PREFIX.error} unknown transport: ${transport}  (use http or stdio)`,
				);
				return;
			}
			try {
				await ctx.connectMcpServer(name);
				writeln(
					`${PREFIX.success} mcp server ${c.cyan(name)} added and connected`,
				);
			} catch (e) {
				writeln(
					`${PREFIX.success} mcp server ${c.cyan(name)} saved  ${c.dim(`(connection failed: ${String(e)})`)}`,
				);
			}
			return;
		}

		case "remove":
		case "rm": {
			const [, name] = parts;
			if (!name) {
				writeln(`${PREFIX.error} usage: /mcp remove <name>`);
				return;
			}
			deleteMcpServer(name);
			writeln(`${PREFIX.success} mcp server ${c.cyan(name)} removed`);
			return;
		}

		default:
			writeln(`${PREFIX.error} unknown: /mcp ${sub}`);
			writeln(c.dim("  subcommands: list · add · remove"));
	}
}
