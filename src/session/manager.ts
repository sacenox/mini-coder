import * as c from "yoctocolors";
import { tildePath, writeln } from "../cli/output.ts";
import type { CoreMessage } from "../llm-api/turn.ts";
import {
  createSession,
  generateSessionId,
  getSession,
  listSessions,
  loadMessages,
  type SessionRow,
  setSessionTitle,
  touchSession,
} from "./db/index.ts";

// ─── Active session ───────────────────────────────────────────────────────────

export interface ActiveSession {
  id: string;
  model: string;
  messages: CoreMessage[];
  createdAt: number;
}

export function newSession(model: string, cwd: string): ActiveSession {
  const id = generateSessionId();
  const row = createSession({ id, cwd, model });
  return { id, model, messages: [], createdAt: row.created_at };
}

export function resumeSession(id: string): ActiveSession | null {
  const row = getSession(id);
  if (!row) return null;
  const messages = loadMessages(id);
  return { id: row.id, model: row.model, messages, createdAt: row.created_at };
}

export function touchActiveSession(session: ActiveSession): void {
  touchSession(session.id, session.model);
}

/** Set the session title from the first user message (only if untitled). */
export function autoTitleSession(sessionId: string, userText: string): void {
  const line = userText.split("\n")[0]?.trim() ?? "";
  if (!line) return;
  const title = line.length > 60 ? `${line.slice(0, 57)}...` : line;
  setSessionTitle(sessionId, title);
}

// ─── List sessions (for --list flag) ─────────────────────────────────────────

function renderSessionTable(footer: string): boolean {
  const sessions = listSessions(20);
  if (sessions.length === 0) return false;

  writeln(`\n${c.bold("Recent sessions:")}`);
  for (const s of sessions) {
    const date = new Date(s.updated_at).toLocaleString();
    const cwd = tildePath(s.cwd);
    const title = s.title || c.dim("(untitled)");
    writeln(
      `  ${c.dim(s.id.padEnd(14))} ${title.padEnd(30)} ${c.cyan(s.model.split("/").pop() ?? s.model).padEnd(20)} ${c.dim(cwd)}  ${c.dim(date)}`,
    );
  }
  writeln(`\n${footer}`);
  return true;
}

export function printSessionList(): void {
  const shown = renderSessionTable(
    `${c.dim("Use")} mc --resume <id> ${c.dim("to continue a session.")}`,
  );
  if (!shown) writeln(c.dim("No sessions found."));
}

// ─── Find the most recent session ─────────────────────────────────────────────

export function getMostRecentSession(): SessionRow | null {
  const sessions = listSessions(1);
  return sessions[0] ?? null;
}
