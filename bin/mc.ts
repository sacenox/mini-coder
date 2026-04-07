#!/usr/bin/env bun

/**
 * Executable launcher for the mini-coder CLI.
 *
 * @module
 */

import { main } from "../src/index.ts";

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
