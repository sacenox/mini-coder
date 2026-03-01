import { getDb } from "./connection.ts";

export interface McpServerRow {
	name: string;
	transport: string;
	url: string | null;
	command: string | null;
	args: string | null; // JSON array
	env: string | null; // JSON object
}

export function listMcpServers(): McpServerRow[] {
	return getDb()
		.query<McpServerRow, []>(
			"SELECT name, transport, url, command, args, env FROM mcp_servers ORDER BY name",
		)
		.all();
}

export function upsertMcpServer(server: McpServerRow): void {
	getDb().run(
		`INSERT INTO mcp_servers (name, transport, url, command, args, env, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       transport = excluded.transport,
       url       = excluded.url,
       command   = excluded.command,
       args      = excluded.args,
       env       = excluded.env`,
		[
			server.name,
			server.transport,
			server.url ?? null,
			server.command ?? null,
			server.args ?? null,
			server.env ?? null,
			Date.now(),
		],
	);
}

export function deleteMcpServer(name: string): void {
	getDb().run("DELETE FROM mcp_servers WHERE name = ?", [name]);
}
