import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { type Static, Type } from "@earendil-works/pi-ai";
import { Value } from "typebox/value";

import { DATA_DIR } from "./shared";
import type { AvailableUpdate } from "./types";

const PACKAGE_NAME = "mini-coder";
const PACKAGE_MANIFEST_URL = new URL("../package.json", import.meta.url);
const UPDATE_CHECK_CACHE_PATH = join(DATA_DIR, "update-check.json");
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_CHECK_TIMEOUT_MS = 5_000;

const UpdateCheckCacheSchema = Type.Object({
  checkedAt: Type.Number(),
  currentVersion: Type.String(),
  latestVersion: Type.Optional(Type.String()),
});
type UpdateCheckCache = Static<typeof UpdateCheckCacheSchema>;

function parseLatestVersion(output: string): string | undefined {
  const version = output.trim().split(/\s+/)[0];

  if (!version || !isValidVersion(version)) {
    return;
  }

  return version;
}

function isValidVersion(version: string): boolean {
  try {
    Bun.semver.order(version, version);
    return true;
  } catch {
    return false;
  }
}

function isNewerVersion(
  currentVersion: string,
  latestVersion: string,
): boolean {
  try {
    return Bun.semver.order(latestVersion, currentVersion) === 1;
  } catch {
    return false;
  }
}

function isFreshUpdateCheck(cache: UpdateCheckCache, now: number): boolean {
  return now - cache.checkedAt < UPDATE_CHECK_INTERVAL_MS;
}

function getAvailableUpdateFromLatest(
  currentVersion: string,
  latestVersion: string | undefined,
): AvailableUpdate | undefined {
  if (!latestVersion || !isNewerVersion(currentVersion, latestVersion)) {
    return;
  }

  return { currentVersion, latestVersion };
}

async function getCurrentVersion(): Promise<string | undefined> {
  const manifest = (await Bun.file(PACKAGE_MANIFEST_URL).json()) as {
    version?: unknown;
  };

  if (typeof manifest.version !== "string") {
    return;
  }

  return manifest.version;
}

async function getLatestVersion(): Promise<string | undefined> {
  try {
    const proc = Bun.spawn(["bun", "pm", "view", PACKAGE_NAME, "version"], {
      stdout: "pipe",
      stderr: "ignore",
      timeout: UPDATE_CHECK_TIMEOUT_MS,
    });
    const [stdout, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      return;
    }

    return parseLatestVersion(stdout);
  } catch {
    return;
  }
}

async function readUpdateCheckCache(): Promise<UpdateCheckCache | undefined> {
  try {
    const file = Bun.file(UPDATE_CHECK_CACHE_PATH);

    if (!(await file.exists())) {
      return;
    }

    const value = (await file.json()) as unknown;

    if (!Value.Check(UpdateCheckCacheSchema, value)) {
      return;
    }

    return value;
  } catch {
    return;
  }
}

async function writeUpdateCheckCache(cache: UpdateCheckCache): Promise<void> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await Bun.write(UPDATE_CHECK_CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch {
    // Update checks are best-effort and must never interrupt startup.
  }
}

export async function getAvailableUpdate(): Promise<
  AvailableUpdate | undefined
> {
  const currentVersion = await getCurrentVersion().catch(() => undefined);

  if (!currentVersion) {
    return;
  }

  const now = Date.now();
  const cache = await readUpdateCheckCache();

  if (cache && isFreshUpdateCheck(cache, now)) {
    return getAvailableUpdateFromLatest(currentVersion, cache.latestVersion);
  }

  const latestVersion = await getLatestVersion();
  await writeUpdateCheckCache({
    checkedAt: now,
    currentVersion,
    latestVersion,
  });

  return getAvailableUpdateFromLatest(currentVersion, latestVersion);
}

export async function updateMiniCoder(): Promise<void> {
  console.log("Updating mini-coder...");

  const proc = Bun.spawn(["bun", "add", "-g", "mini-coder@latest"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Update failed with exit code ${exitCode}`);
  }

  console.log("mini-coder updated.");
}
