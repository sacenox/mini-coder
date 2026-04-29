import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Message } from "@mariozechner/pi-ai";
import { Value } from "typebox/value";
import { SESSIONS_DIR } from "./shared";
import { type Session, SessionSchema } from "./types";

// TODO: sessions are json files in SESSIONS_DIR inside of DATA_DIR, use a 10 length `secureRandomString()` for the ids.

export async function ensureSessionsDir(): Promise<void> {
  await mkdir(SESSIONS_DIR, { recursive: true });
}

// readSession: writes the session
export async function getSession(id: string): Promise<Session | undefined> {
  const file = Bun.file(join(SESSIONS_DIR, `${id}.json`));

  if (!(await file.exists())) {
    return;
  }

  const sessionJson = await file.text();
  const parsed = JSON.parse(sessionJson) as unknown;
  const valid = Value.Check(SessionSchema, parsed);

  if (valid) return parsed;
  return;
}

function latestMessageTimestamp(session: Session): number {
  return Math.max(0, ...session.messages.map((message) => message.timestamp));
}

export async function listSessionsForCwd(): Promise<Session[]> {
  const sessions: Session[] = [];
  const sessionFiles = new Bun.Glob("*.json");
  const cwd = process.cwd();

  try {
    for await (const entry of sessionFiles.scan({
      cwd: SESSIONS_DIR,
      dot: true,
    })) {
      try {
        const sessionJson = await Bun.file(join(SESSIONS_DIR, entry)).text();
        const parsed = JSON.parse(sessionJson) as unknown;

        if (Value.Check(SessionSchema, parsed) && cwd === parsed.cwd) {
          sessions.push(parsed);
        }
      } catch {
        // Ignore invalid session files.
      }
    }
  } catch {
    return [];
  }

  return sessions.sort(
    (a, b) => latestMessageTimestamp(b) - latestMessageTimestamp(a),
  );
}

export async function saveSession(s: Session) {
  await ensureSessionsDir();
  const file = Bun.file(join(SESSIONS_DIR, `${s.id}.json`));
  await Bun.write(file, JSON.stringify(s));
}

// updateSession: finds and appends to the existing setting file
export async function updateSession(id: string, messages: Message[]) {
  const existing = await getSession(id);
  if (existing) {
    existing.messages = messages;
    await saveSession(existing);
    return;
  }

  const s = {
    id,
    cwd: process.cwd(),
    messages,
  };

  await saveSession(s);
}
