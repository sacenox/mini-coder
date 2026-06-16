import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBashTool } from "./tool-bash.ts";
import { runEditTool } from "./tool-edit.ts";
import { runReadTool } from "./tool-read.ts";
import type { ToolRunnerEvent } from "./types.ts";

const originalDataDir = Bun.env.MINI_CODER_DATA_DIR;
const testHome = await mkdtemp(join(tmpdir(), "mini-coder-errors-"));
const dataDir = join(testHome, "data");
Bun.env.MINI_CODER_DATA_DIR = dataDir;

const sessionsDir = join(dataDir, "sessions");
const { handleArgv } = await import("./args.ts");
const { getAvailableProviders } = await import("./oauth.ts");
const { getSession, listSessionsForCwd } = await import("./session.ts");

type ResultEvent = Extract<ToolRunnerEvent, { type: "result" }>;

async function collectToolEvents(
  events: AsyncGenerator<ToolRunnerEvent>,
): Promise<ToolRunnerEvent[]> {
  const collected: ToolRunnerEvent[] = [];

  for await (const event of events) {
    collected.push(event);
  }

  return collected;
}

function resultEvent(events: ToolRunnerEvent[]): ResultEvent {
  const result = events.findLast(
    (event): event is ResultEvent => event.type === "result",
  );

  if (!result) {
    throw new Error("Tool did not yield a result");
  }

  return result;
}

async function toolResult(
  events: AsyncGenerator<ToolRunnerEvent>,
): Promise<ResultEvent> {
  return resultEvent(await collectToolEvents(events));
}

beforeEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

afterAll(async () => {
  if (originalDataDir === undefined) {
    delete Bun.env.MINI_CODER_DATA_DIR;
  } else {
    Bun.env.MINI_CODER_DATA_DIR = originalDataDir;
  }

  await rm(testHome, { recursive: true, force: true });
});

describe("tool runner error handling", () => {
  test("read and edit report missing files as tool results", async () => {
    const missingPath = join(testHome, "missing.txt");

    const readResult = await toolResult(runReadTool({ path: missingPath }));
    expect(readResult.text).toBe(`File not found: ${missingPath}`);

    const editResult = await toolResult(
      runEditTool({ path: missingPath, oldText: "old", newText: "new" }),
    );
    expect(editResult.text).toBe(`File not found: ${missingPath}`);
  });

  test("edit refuses unsafe writes and preserves the file", async () => {
    const path = join(testHome, "edit.txt");
    await writeFile(path, "one\none\n");

    const ambiguous = await toolResult(
      runEditTool({ path, oldText: "one", newText: "two" }),
    );
    expect(ambiguous.text).toContain("Multiple matches found");
    expect(await Bun.file(path).text()).toBe("one\none\n");

    const missing = await toolResult(
      runEditTool({ path, oldText: "missing", newText: "two" }),
    );
    expect(missing.text).toBe(`Old text not found in: ${path}`);
    expect(await Bun.file(path).text()).toBe("one\none\n");

    const abortController = new AbortController();
    abortController.abort();
    await writeFile(path, "hello");

    const aborted = await toolResult(
      runEditTool(
        { path, oldText: "hello", newText: "bye" },
        abortController.signal,
      ),
    );
    expect(aborted.text).toBe("Aborted before write.");
    expect(await Bun.file(path).text()).toBe("hello");
  });

  test("bash reports non-zero exits instead of throwing", async () => {
    const result = await toolResult(
      runBashTool({ command: 'printf "bad"; exit 7' }),
    );

    expect(result.text).toBe("bad\n\nExit code: 7");
  });
});

describe("startup file error handling", () => {
  test("settings JSON parse failures are labelled", async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, "settings.json"), "{");

    await expect(handleArgv([])).rejects.toThrow("Invalid settings JSON:");
  });

  test("auth JSON parse failures are labelled", async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, "auth.json"), "{");

    await expect(getAvailableProviders()).rejects.toThrow("Invalid auth JSON:");
  });
});

describe("session file error handling", () => {
  test("listSessionsForCwd ignores missing dirs and bad session files", async () => {
    expect(await listSessionsForCwd()).toEqual([]);

    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, "broken.json"), "{");
    await writeFile(
      join(sessionsDir, "elsewhere.json"),
      JSON.stringify({ id: "elsewhere", cwd: "/elsewhere", messages: [] }),
    );
    await writeFile(
      join(sessionsDir, "ok.json"),
      JSON.stringify({
        id: "ok",
        cwd: process.cwd(),
        messages: [{ role: "user", content: "hi", timestamp: 2 }],
      }),
    );

    const sessions = await listSessionsForCwd();
    expect(sessions.map((session) => session.id)).toEqual(["ok"]);
  });

  test("getSession returns undefined for bad session files", async () => {
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, "broken.json"), "{");

    expect(await getSession("broken")).toBeUndefined();
  });
});
