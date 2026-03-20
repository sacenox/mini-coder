import * as c from "yoctocolors";
import type { ThinkingEffort } from "../llm-api/providers.ts";
import { fetchAvailableModels } from "../llm-api/providers.ts";
import { PREFIX, writeln } from "./output.ts";
import type { CommandContext } from "./types.ts";

const THINKING_EFFORTS: ThinkingEffort[] = ["low", "medium", "high", "xhigh"];

function parseThinkingEffort(value: string): ThinkingEffort | null {
  return THINKING_EFFORTS.includes(value as ThinkingEffort)
    ? (value as ThinkingEffort)
    : null;
}

function findModelIdByAlias(
  requestedModel: string,
  availableModelIds: string[],
): string | null {
  for (const id of availableModelIds) {
    if (id === requestedModel) return id;
    const alias = id.split("/").slice(1).join("/");
    if (alias === requestedModel) return id;
  }
  return null;
}

function renderModelUpdatedMessage(
  ctx: CommandContext,
  modelId: string,
  effortArg?: string,
): void {
  if (effortArg) {
    if (effortArg === "off") {
      ctx.setThinkingEffort(null);
      writeln(
        `${PREFIX.success} model → ${c.cyan(modelId)} ${c.dim("(thinking disabled)")}`,
      );
      return;
    }

    const effort = parseThinkingEffort(effortArg);
    if (effort) {
      ctx.setThinkingEffort(effort);
      writeln(
        `${PREFIX.success} model → ${c.cyan(modelId)} ${c.dim(`(✦ ${effort})`)}`,
      );
      return;
    }

    writeln(`${PREFIX.success} model → ${c.cyan(modelId)}`);
    writeln(
      `${PREFIX.error} unknown effort level ${c.cyan(effortArg)} (use low, medium, high, xhigh, off)`,
    );
    return;
  }

  const effortTag = ctx.thinkingEffort
    ? c.dim(` (✦ ${ctx.thinkingEffort})`)
    : "";
  writeln(`${PREFIX.success} model → ${c.cyan(modelId)}${effortTag}`);
}

async function handleModelSet(
  ctx: CommandContext,
  args: string,
): Promise<void> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const idArg = parts[0] ?? "";
  const effortArg = parts[1];
  if (!idArg) return;

  let modelId = idArg;
  if (!idArg.includes("/")) {
    const snapshot = await fetchAvailableModels();
    const match = findModelIdByAlias(
      idArg,
      snapshot.models.map((model) => model.id),
    );
    if (!match) {
      writeln(
        `${PREFIX.error} unknown model ${c.cyan(idArg)}  ${c.dim("— run /models for the full list")}`,
      );
      return;
    }
    modelId = match;
  }

  ctx.setModel(modelId);
  renderModelUpdatedMessage(ctx, modelId, effortArg);
}

function handleModelEffort(ctx: CommandContext, effortArg: string): void {
  if (effortArg === "off") {
    ctx.setThinkingEffort(null);
    writeln(`${PREFIX.success} thinking effort disabled`);
    return;
  }

  const effort = parseThinkingEffort(effortArg);
  if (!effort) {
    writeln(`${PREFIX.error} usage: /model effort <low|medium|high|xhigh|off>`);
    return;
  }

  ctx.setThinkingEffort(effort);
  writeln(`${PREFIX.success} thinking effort → ${c.cyan(effort)}`);
}

async function renderModelList(ctx: CommandContext): Promise<void> {
  ctx.startSpinner("fetching models");
  const snapshot = await fetchAvailableModels();
  ctx.stopSpinner();

  if (snapshot.models.length === 0) {
    writeln(
      `${PREFIX.error} No models found. Check your API keys or Ollama connection.`,
    );
    writeln(
      c.dim(
        "  Set OPENCODE_API_KEY for Zen, or start Ollama for local models.",
      ),
    );
    return;
  }

  if (snapshot.stale) {
    const lastSync = snapshot.lastSyncAt
      ? new Date(snapshot.lastSyncAt).toLocaleString()
      : "never";
    const refreshTag = snapshot.refreshing ? " (refreshing in background)" : "";
    writeln(
      c.dim(`  model metadata is stale (last sync: ${lastSync})${refreshTag}`),
    );
  }

  const modelsByProvider = new Map<string, typeof snapshot.models>();
  for (const model of snapshot.models) {
    const providerModels = modelsByProvider.get(model.provider);
    if (providerModels) {
      providerModels.push(model);
    } else {
      modelsByProvider.set(model.provider, [model]);
    }
  }

  writeln();
  for (const [provider, providerModels] of modelsByProvider) {
    writeln(c.bold(`  ${provider}`));
    for (const model of providerModels) {
      const isCurrent = ctx.currentModel === model.id;
      const freeTag = model.free ? c.green(" free") : "";
      const contextTag = model.context
        ? c.dim(` ${Math.round(model.context / 1000)}k`)
        : "";
      const effortTag =
        isCurrent && ctx.thinkingEffort
          ? c.dim(` ✦ ${ctx.thinkingEffort}`)
          : "";
      const currentTag = isCurrent ? c.cyan(" ◀") : "";
      writeln(
        `    ${c.dim("·")} ${model.displayName}${freeTag}${contextTag}${currentTag}${effortTag}`,
      );
      writeln(`      ${c.dim(model.id)}`);
    }
  }

  writeln();
  writeln(
    c.dim("  /model <id>  to switch  ·  e.g. /model zen/claude-sonnet-4-6"),
  );
  writeln(
    c.dim(
      "  /model effort <low|medium|high|xhigh|off>  to set thinking effort",
    ),
  );
}

export async function handleModelCommand(
  ctx: CommandContext,
  args: string,
): Promise<void> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    await renderModelList(ctx);
    return;
  }

  if (parts[0] === "effort") {
    handleModelEffort(ctx, parts[1] ?? "");
    return;
  }

  await handleModelSet(ctx, args);
}
