import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { Message, Tool } from "@earendil-works/pi-ai";

export interface SessionHeader {
  type: "session";
  version: 1;
  id: string;
  cwd: string;
  createdAt: string;
  title: string;
}

export interface RequestRecord {
  type: "request";
  at: string;
  provider: string;
  model: string;
  api: string;
  thinkingEffort: string;
  systemPrompt: string;
  tools: Tool[];
}

export interface MessageRecord {
  type: "message";
  at: string;
  message: Message;
}

export type SessionRecord = SessionHeader | RequestRecord | MessageRecord;

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || "session";
}

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function shortId(): string {
  const bytes = randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i++) out += ALPHABET[bytes[i] % 36];
  return out;
}

function timestamp(date: Date): string {
  const p = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`
  );
}

function titleFor(message: Message): string {
  if (message.role !== "user") return "session";
  const text = typeof message.content === "string"
    ? message.content
    : message.content.map((block) => (block.type === "text" ? block.text : "")).join(" ");
  return slugify(text);
}

export class Session {
  readonly sessionsDir: string;
  readonly cwd: string;
  id: string | null = null;
  logPath: string | null = null;
  private fd: number | null = null;

  constructor(sessionsDir: string, cwd: string) {
    this.sessionsDir = sessionsDir;
    this.cwd = cwd;
  }

  appendMessage(message: Message): void {
    this.ensure(titleFor(message));
    this.write({
      type: "message",
      at: new Date().toISOString(),
      message,
    });
  }

  appendRequest(input: Omit<RequestRecord, "type" | "at">): void {
    this.ensure("session");
    this.write({ type: "request", at: new Date().toISOString(), ...input });
  }

  close(): void {
    if (this.fd !== null) {
      closeSync(this.fd);
      this.fd = null;
    }
  }

  private ensure(title: string): void {
    if (this.fd !== null) return;
    mkdirSync(this.sessionsDir, { recursive: true });
    const stamp = timestamp(new Date());
    for (let attempt = 0; attempt < 16; attempt++) {
      const name = `${stamp}-${title}-${shortId()}`;
      const dir = join(this.sessionsDir, name);
      try {
        mkdirSync(dir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw error;
      }
      this.id = name;
      this.logPath = join(dir, "session.jsonl");
      this.fd = openSync(this.logPath, "a");
      const header: SessionHeader = {
        type: "session",
        version: 1,
        id: name,
        cwd: this.cwd,
        createdAt: new Date().toISOString(),
        title,
      };
      this.write(header);
      this.ignoreDefaultDir();
      return;
    }
    throw new Error(`session: could not create a unique directory in ${this.sessionsDir}`);
  }

  private write(record: SessionRecord): void {
    if (this.fd === null) throw new Error("session: append before create");
    writeSync(this.fd, JSON.stringify(record) + "\n");
    fsyncSync(this.fd);
  }

  private ignoreDefaultDir(): void {
    if (this.sessionsDir !== join(this.cwd, "sessions")) return;
    const path = join(this.cwd, ".gitignore");
    const entry = "sessions/";
    if (existsSync(path) && readFileSync(path, "utf8").split("\n").includes(entry)) return;
    appendFileSync(path, entry + "\n");
  }
}

export function readSession(logPath: string): SessionRecord[] {
  const lines = readFileSync(logPath, "utf8").split("\n");
  let last = lines.length - 1;
  while (last >= 0 && lines[last] === "") last--;
  const records: SessionRecord[] = [];
  for (let i = 0; i <= last; i++) {
    if (lines[i] === "") continue;
    try {
      records.push(JSON.parse(lines[i]) as SessionRecord);
    } catch (error) {
      if (i === last) return records;
      throw new Error(`session corruption at line ${i + 1}: ${(error as Error).message}`);
    }
  }
  return records;
}
