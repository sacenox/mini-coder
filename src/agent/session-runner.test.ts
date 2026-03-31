import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sessionRunnerModuleUrl = new URL("./session-runner.ts", import.meta.url)
  .href;
const skillsModuleUrl = new URL("../tools/skills.ts", import.meta.url).href;

function runInHome(
  home: string,
  cwd: string,
  script: string,
): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const scriptPath = join(
    tmpdir(),
    `mc-session-runner-test-${process.pid}-${Date.now()}.mjs`,
  );
  writeFileSync(scriptPath, script);
  try {
    const result = Bun.spawnSync([process.execPath, scriptPath], {
      cwd,
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

describe("SessionRunner session switching", () => {
  let cwd = "";
  let fakeHome = "";

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "mc-session-runner-cwd-"));
    fakeHome = mkdtempSync(join(tmpdir(), "mc-session-runner-home-"));
    const skillDir = join(cwd, ".agents", "skills", "deploy");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: deploy\ndescription: Deploy app\n---\n\nFull body",
    );
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  });

  test("throws when asked to resume a missing session", () => {
    const result = runInHome(
      fakeHome,
      cwd,
      `
        import { SessionRunner } from ${JSON.stringify(sessionRunnerModuleUrl)};

        const reporter = {
          info() {},
          error() {},
          warn() {},
          writeText() {},
          startSpinner() {},
          stopSpinner() {},
          async renderTurn() {
            throw new Error("renderTurn should not be called in this test");
          },
          renderStatusBar() {},
          restoreTerminal() {},
        };

        try {
          new SessionRunner({
            cwd: ${JSON.stringify(cwd)},
            reporter,
            tools: [],
            mcpTools: [],
            initialModel: "ollama/llama3.2",
            initialThinkingEffort: null,
            initialShowReasoning: false,
            initialVerboseOutput: false,
            sessionId: "missing-session",
          });
          console.log("no-error");
        } catch (error) {
          console.log(JSON.stringify({
            name: error instanceof Error ? error.name : typeof error,
            message: error instanceof Error ? error.message : String(error),
          }));
        }
      `,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      name: "Error",
      message: 'Session "missing-session" not found.',
    });
  });

  test("switchSession resets activated skill state", () => {
    const result = runInHome(
      fakeHome,
      cwd,
      `
        import { SessionRunner } from ${JSON.stringify(sessionRunnerModuleUrl)};
        import { readSkillTool } from ${JSON.stringify(skillsModuleUrl)};

        const reporter = {
          info() {},
          error() {},
          warn() {},
          writeText() {},
          startSpinner() {},
          stopSpinner() {},
          async renderTurn() {
            throw new Error("renderTurn should not be called in this test");
          },
          renderStatusBar() {},
          restoreTerminal() {},
        };

        const runner = new SessionRunner({
          cwd: ${JSON.stringify(cwd)},
          reporter,
          tools: [],
          mcpTools: [],
          initialModel: "ollama/llama3.2",
          initialThinkingEffort: null,
          initialShowReasoning: false,
          initialVerboseOutput: false,
        });

        const firstSessionId = runner.session.id;
        const firstRead = await readSkillTool.execute({ cwd: ${JSON.stringify(cwd)}, name: "deploy" });
        const cachedRead = await readSkillTool.execute({ cwd: ${JSON.stringify(cwd)}, name: "deploy" });
        runner.startNewSession();
        const secondSessionId = runner.session.id;
        const secondRead = await readSkillTool.execute({ cwd: ${JSON.stringify(cwd)}, name: "deploy" });
        const switched = runner.switchSession(firstSessionId);
        const afterSwitchRead = await readSkillTool.execute({ cwd: ${JSON.stringify(cwd)}, name: "deploy" });

        console.log(JSON.stringify({
          firstSessionId,
          secondSessionId,
          switched,
          firstRead: firstRead.skill?.name ?? null,
          cachedRead: cachedRead.skill?.name ?? null,
          secondRead: secondRead.skill?.name ?? null,
          afterSwitchRead: afterSwitchRead.skill?.name ?? null,
        }));
      `,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      switched: true,
      firstRead: "deploy",
      cachedRead: null,
      secondRead: "deploy",
      afterSwitchRead: "deploy",
    });
  });
});
