#!/usr/bin/env bun
// Suppress AI SDK warnings that leak into user-visible CLI output.
// We handle errors/warnings through our own reporting layer.
globalThis.AI_SDK_LOG_WARNINGS = false;

import * as c from "yoctocolors";
import { initAgent } from "./agent/agent.ts";
import { runWithTeardown } from "./agent/run-with-teardown.ts";
import { parseArgs, printHelp } from "./cli/args.ts";

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
import { getLocalProviderNames } from "./llm-api/provider-discovery.ts";
import {
  autoDiscoverModel,
  discoverConnectedProviders,
} from "./llm-api/providers.ts";

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
  const connectedProviders = prompt
    ? undefined
    : await discoverConnectedProviders();

  const startupLocalProviders = connectedProviders
    ? getLocalProviderNames(connectedProviders)
    : undefined;
  void refreshModelInfoInBackground(
    startupLocalProviders
      ? { localProviders: startupLocalProviders }
      : undefined,
  ).catch(() => {});

  if (!prompt) {
    // Only show banner for interactive sessions, not piped/one-shot
    await renderBanner(model, args.cwd, connectedProviders);
  }

  let runner: Awaited<ReturnType<typeof initAgent>>["runner"] | null = null;
  const oneShot = !!prompt;
  const agentOpts = buildAgentOptions({
    model,
    cwd: args.cwd,
    reporter: new CliReporter(oneShot),
    sessionId,
  });

  await runWithTeardown({
    run: async () => {
      const init = await initAgent(agentOpts);
      runner = init.runner;
      const { cmdCtx } = init;

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
          writeln(responseText.trimStart());
        }
        return;
      }

      await runInputLoop({
        cwd: args.cwd,
        reporter: agentOpts.reporter,
        cmdCtx,
        runner,
      });
    },
    teardown: () => runner?.teardown() ?? Promise.resolve(),
    renderError: (err) => {
      if (!(err instanceof RenderedError)) {
        renderError(err, "agent");
      }
    },
  });
}

main().then(
  () => process.exit(0),
  (err) => {
    if (!(err instanceof RenderedError)) {
      renderError(err, "main");
    }
    process.exit(1);
  },
);
