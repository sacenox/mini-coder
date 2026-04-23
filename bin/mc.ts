#!/usr/bin/env bun
import { main } from "../src/index.ts";

if (import.meta.main) {
  try {
    await main();
  } catch (err) {
    console.log(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
