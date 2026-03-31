import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const messageRepoModuleUrl = new URL("./message-repo.ts", import.meta.url).href;
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
    `mc-message-repo-test-${process.pid}-${Date.now()}.mjs`,
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

describe("loadMessages", () => {
  let fakeHome = "";

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "mc-message-home-"));
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  test("skips invalid message rows without writing CLI output", () => {
    const result = runInHome(
      fakeHome,
      `
        import { loadMessages } from ${JSON.stringify(messageRepoModuleUrl)};
        import { getDb } from ${JSON.stringify(connectionModuleUrl)};
        const db = getDb();
        db.run("INSERT INTO sessions (id, cwd, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", ["s1", "/tmp", "zen/gpt-5.4", 1, 1]);
        db.run("INSERT INTO messages (session_id, payload, turn_index, created_at) VALUES (?, ?, ?, ?)", ["s1", "{not-json", 0, 1]);
        const messages = loadMessages("s1");
        console.log(JSON.stringify({ count: messages.length }));
      `,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe('{"count":0}');
  });
});
