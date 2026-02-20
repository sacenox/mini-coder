import { homedir } from "node:os";
import { relative } from "node:path";
import * as c from "yoctocolors";
import { PREFIX, writeln } from "../cli/output.ts";
import type { Message } from "../llm-api/types.ts";
import {
	type SessionRow,
	createSession,
	generateSessionId,
	getSession,
	listSessions,
	loadMessages,
	touchSession,
} from "./db.ts";

// ─── Active session ───────────────────────────────────────────────────────────

export interface ActiveSession {
	id: string;
	model: string;
	messages: Message[];
}

export function newSession(model: string, cwd: string): ActiveSession {
	const id = generateSessionId();
	createSession({ id, cwd, model });
	return { id, model, messages: [] };
}

export function resumeSession(id: string): ActiveSession | null {
	const row = getSession(id);
	if (!row) return null;
	const messages = loadMessages(id);
	return { id: row.id, model: row.model, messages };
}

export function touchActiveSession(session: ActiveSession): void {
	touchSession(session.id, session.model);
}

// ─── List sessions (for --list flag) ─────────────────────────────────────────

export function printSessionList(): void {
	const sessions = listSessions(20);
	if (sessions.length === 0) {
		writeln(c.dim("No sessions found."));
		return;
	}

	writeln(`\n${c.bold("Recent sessions:")}`);
	for (const s of sessions) {
		const date = new Date(s.updated_at).toLocaleString();
		const cwd = s.cwd.startsWith(homedir())
			? `~${s.cwd.slice(homedir().length)}`
			: s.cwd;
		const title = s.title || c.dim("(untitled)");
		writeln(
			`  ${c.dim(s.id.padEnd(14))} ${title.padEnd(30)} ${c.cyan(s.model.split("/").pop() ?? s.model).padEnd(20)} ${c.dim(cwd)}  ${c.dim(date)}`,
		);
	}
	writeln(
		`\n${c.dim("Use")} mc --resume <id> ${c.dim("to continue a session.")}`,
	);
}

// ─── Find the most recent session ─────────────────────────────────────────────

export function getMostRecentSession(): SessionRow | null {
	const sessions = listSessions(1);
	return sessions[0] ?? null;
}
