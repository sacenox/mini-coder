import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const connectionModuleUrl = new URL(
  "../session/db/connection.ts",
  import.meta.url,
).href;
const prepareModuleUrl = new URL("./turn-prepare-messages.ts", import.meta.url)
  .href;

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
    `mc-turn-prepare-test-${process.pid}-${Date.now()}.mjs`,
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

describe("prepareTurnMessages ignores stale Anthropic OAuth rows", () => {
  let fakeHome = "";

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "mc-turn-prepare-home-"));
    mkdirSync(join(fakeHome, ".config", "mini-coder"), { recursive: true });
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  test("treats direct anthropic and zen/claude the same when an old anthropic oauth row exists", () => {
    const result = runInHome(
      fakeHome,
      `
        import { getDb } from ${JSON.stringify(connectionModuleUrl)};
        import { prepareTurnMessages } from ${JSON.stringify(prepareModuleUrl)};

        const db = getDb();
        db.run(
          "INSERT INTO oauth_tokens (provider, access_token, refresh_token, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)",
          ["anthropic", "token", "refresh", ${Date.now() + 60_000}, ${Date.now()}],
        );

        const anthropic = prepareTurnMessages({
          messages: [{ role: "user", content: "hi" }],
          modelString: "anthropic/claude-sonnet-4-6",
          toolCount: 0,
          systemPrompt: "sys",
        });
        const zen = prepareTurnMessages({
          messages: [{ role: "user", content: "hi" }],
          modelString: "zen/claude-sonnet-4-6",
          toolCount: 0,
          systemPrompt: "sys",
        });

        console.log(JSON.stringify({
          anthropicMessages: anthropic.messages,
          anthropicSystemPrompt: anthropic.systemPrompt,
          zenMessages: zen.messages,
          zenSystemPrompt: zen.systemPrompt,
        }));
      `,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      anthropicMessages: [{ role: "user", content: "hi" }],
      anthropicSystemPrompt: "sys",
      zenMessages: [{ role: "user", content: "hi" }],
      zenSystemPrompt: "sys",
    });
  });
});
