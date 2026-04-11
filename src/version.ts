/**
 * Version helpers for the interactive empty-state banner.
 *
 * @module
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** App name shown in the empty conversation banner. */
export const APP_NAME = "mini-coder";

/** Fallback label used when running from a local checkout instead of a packaged install. */
export const DEV_VERSION_LABEL = "dev";

/**
 * Resolve the version label shown in the empty conversation banner.
 *
 * Packaged installs read their version from the colocated `package.json`.
 * Local checkouts fall back to a simple `dev` label so banner metadata never
 * risks interfering with normal startup.
 *
 * @param appRoot - App root containing `package.json`.
 * @returns A display label such as `v0.5.1` or `dev`.
 */
export function resolveAppVersionLabel(
  appRoot = join(import.meta.dir, ".."),
): string {
  if (existsSync(join(appRoot, ".git"))) {
    return DEV_VERSION_LABEL;
  }

  const packageJsonPath = join(appRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return DEV_VERSION_LABEL;
  }

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" && parsed.version !== ""
      ? `v${parsed.version}`
      : DEV_VERSION_LABEL;
  } catch {
    return DEV_VERSION_LABEL;
  }
}
