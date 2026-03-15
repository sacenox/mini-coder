#!/usr/bin/env bun
import { runFileEditCli } from "./internal/file-edit/cli.ts";

const exitCode = await runFileEditCli(process.argv.slice(2));
process.exit(exitCode);
