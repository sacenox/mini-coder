import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSqliteBusyError } from "./connection.ts";

const connectionModuleUrl = new URL("./connection.ts", import.meta.url).href;

function runInHome(
  home: string,
  script: string,
): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const scriptPath = join(
    tmpdir(),
    `mc-connection-test-${process.pid}-${Date.now()}.mjs`,
  );
  writeFileSync(scriptPath, script);
  try {
    const result = Bun.spawnSync([process.execPath, scriptPath], {
      env: { ...process.env, HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  } finally {
    rmSync(scriptPath, { force: true });
  }
}

describe("isSqliteBusyError", () => {
  test("matches sqlite busy messages", () => {
    expect(
      isSqliteBusyError(new Error("SQLiteError: database is locked")),
    ).toBe(true);
    expect(
      isSqliteBusyError(new Error("SQLITE_BUSY: database is locked")),
    ).toBe(true);
  });

  test("ignores unrelated errors", () => {
    expect(isSqliteBusyError(new Error("network timeout"))).toBe(false);
    expect(isSqliteBusyError("database is locked")).toBe(false);
  });
});

describe("getDb schema version handling", () => {
  let fakeHome = "";

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "mc-db-home-"));
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  test("rotates old database files aside and creates a fresh DB", () => {
    const configDir = join(fakeHome, ".config", "mini-coder");
    mkdirSync(configDir, { recursive: true });
    const dbPath = join(configDir, "sessions.db");

    const db = new Database(dbPath, { create: true });
    db.exec("PRAGMA journal_mode=WAL;");
    db.exec(`CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      cwd TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );`);
    db.exec(
      "INSERT INTO sessions (id, cwd, model, created_at, updated_at) VALUES ('keepme', '/tmp', 'x/y', 1, 1);",
    );
    db.exec("PRAGMA user_version = 5;");
    db.close();

    const result = runInHome(
      fakeHome,
      `
        import { getDb } from ${JSON.stringify(connectionModuleUrl)};
        const db = getDb();
        const currentCount = db.query("SELECT COUNT(*) AS c FROM sessions").get()?.c ?? 0;
        console.log(JSON.stringify({ currentCount }));
      `,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ currentCount: 0 });
    expect(existsSync(dbPath)).toBe(true);

    const files = readdirSync(configDir).sort();
    const backupBase = files.find((file) =>
      file.startsWith("sessions.db.bak-v5-"),
    );
    expect(backupBase).toBeString();
  });
});
