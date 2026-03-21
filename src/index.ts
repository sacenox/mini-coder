#!/usr/bin/env bun
import * as c from "yoctocolors";
import { initAgent } from "./agent/agent.ts";
import { parseArgs, printHelp } from "./cli/args.ts";
import { bootstrapGlobalDefaults } from "./cli/bootstrap.ts";

import { resolveFileRefs } from "./cli/file-refs.ts";
import { runInputLoop } from "./cli/input-loop.ts";
import {
  CliReporter,
  RenderedError,
  registerTerminalCleanup,
  renderBanner,
  renderError,
  writeln,
} from "./cli/output.ts";
import { resolvePromptInput } from "./cli/stdin-prompt.ts";
import { terminal } from "./cli/terminal-io.ts";

import {
  initModelInfoCache,
  refreshModelInfoInBackground,
} from "./llm-api/model-info.ts";
import { autoDiscoverModel } from "./llm-api/providers.ts";

import {
  getPreferredModel,
  getPreferredShowReasoning,
  getPreferredThinkingEffort,
  getPreferredVerboseOutput,
  pruneOldData,
} from "./session/db/index.ts";
import { getMostRecentSession, printSessionList } from "./session/manager.ts";

// Register terminal cleanup handlers as early as possible so the cursor is
// always restored even if the process crashes or is killed.
registerTerminalCleanup();
initModelInfoCache();
pruneOldData();
void refreshModelInfoInBackground().catch(() => {});

type AgentInitOptions = Parameters<typeof initAgent>[0];

function buildAgentOptions(opts: {
  model: string;
  cwd: string;
  reporter: AgentInitOptions["reporter"];
  sessionId?: string | undefined;
}): AgentInitOptions {
  return {
    model: opts.model,
    cwd: opts.cwd,
    initialThinkingEffort: getPreferredThinkingEffort(),
    initialShowReasoning: getPreferredShowReasoning(),
    initialVerboseOutput: getPreferredVerboseOutput(),
    reporter: opts.reporter,
    ...(opts.sessionId !== undefined && { sessionId: opts.sessionId }),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.list) {
    printSessionList();
    process.exit(0);
  }

  const prompt = await resolvePromptInput(args.prompt);
  if (!prompt && !terminal.isTTY) {
    renderError(
      new Error(
        "No prompt provided. Pass a prompt argument or pipe text on stdin.",
      ),
      "input",
    );
    process.exit(1);
  }

  // Determine session
  let sessionId: string | undefined;
  if (args.resumeLast) {
    const last = getMostRecentSession();
    if (last) {
      sessionId = last.id;
    } else {
      writeln(c.dim("No previous session found, starting fresh."));
    }
  } else if (args.sessionId) {
    sessionId = args.sessionId;
  }

  // Determine model: CLI flag > persisted user preference > auto-discover
  const model = args.model ?? getPreferredModel() ?? autoDiscoverModel();

  bootstrapGlobalDefaults();

  if (!prompt) {
    // Only show banner for interactive sessions, not piped/one-shot
    renderBanner(model, args.cwd);
  }

  try {
    const oneShot = !!prompt;
    const agentOpts = buildAgentOptions({
      model,
      cwd: args.cwd,
      reporter: new CliReporter(oneShot),
      sessionId,
    });

    const { runner, cmdCtx } = await initAgent(agentOpts);

    if (oneShot) {
      const { text: resolvedText, images: refImages } = await resolveFileRefs(
        prompt,
        args.cwd,
      );
      const responseText = await runner.processUserInput(
        resolvedText,
        refImages,
      );
      if (responseText) {
        writeln(responseText);
      }
      return;
    }

    await runInputLoop({
      cwd: args.cwd,
      reporter: agentOpts.reporter,
      cmdCtx,
      runner,
    });
  } catch (err) {
    if (!(err instanceof RenderedError)) {
      renderError(err, "agent");
    }
    process.exit(1);
  }
}

main().catch((err) => {
  if (!(err instanceof RenderedError)) {
    renderError(err, "main");
  }
  process.exit(1);
});
