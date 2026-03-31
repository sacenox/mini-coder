import { describe, expect, test } from "bun:test";
import { isLoggedIn } from "../session/oauth/auth-storage.ts";
import {
  buildModelMatchIndex,
  getProvidersToRefreshFromEnv,
  getRemoteProvidersFromEnv,
  isProviderVisibleInSnapshot,
  isStaleTimestamp,
  MODEL_INFO_TTL_MS,
  matchCanonicalModelId,
  normalizeModelId,
  parseModelsDevCapabilities,
  resolveModelInfoFromRows,
  shouldBlockOnMissingVisibleProviderModels,
} from "./model-info.ts";

const openAIOAuth = isLoggedIn("openai");

describe("provider sync policy", () => {
  test("freshness providers exclude ollama", () => {
    expect(
      getRemoteProvidersFromEnv({
        OPENAI_API_KEY: "x",
        GOOGLE_API_KEY: "y",
      }),
    ).toEqual(["openai", "google"]);
  });

  test("refresh providers include reachable local providers only when discovered", () => {
    expect(getProvidersToRefreshFromEnv({ OPENAI_API_KEY: "x" })).toEqual([
      "openai",
    ]);

    expect(
      getProvidersToRefreshFromEnv(
        { ANTHROPIC_API_KEY: "x" },
        { localProviders: ["ollama"] },
      ),
    ).toEqual(["anthropic", ...(openAIOAuth ? ["openai"] : []), "ollama"]);
  });

  test("snapshot visibility tracks configured and discovered providers", () => {
    expect(isProviderVisibleInSnapshot("openai", { OPENAI_API_KEY: "x" })).toBe(
      true,
    );
    expect(isProviderVisibleInSnapshot("anthropic", {})).toBe(false);
    expect(
      isProviderVisibleInSnapshot("anthropic", { ANTHROPIC_API_KEY: "x" }),
    ).toBe(true);
    expect(isProviderVisibleInSnapshot("ollama", {})).toBe(false);
    expect(
      isProviderVisibleInSnapshot("ollama", {}, { localProviders: ["ollama"] }),
    ).toBe(true);
    expect(isProviderVisibleInSnapshot("zen", {})).toBe(false);
    expect(isProviderVisibleInSnapshot("zen", { OPENCODE_API_KEY: "x" })).toBe(
      true,
    );
  });

  test("blocks when visible providers are missing cached models", () => {
    expect(
      shouldBlockOnMissingVisibleProviderModels({
        hasAnyCachedModels: true,
        hasCachedModelsForAllVisibleProviders: false,
      }),
    ).toBe(true);
    expect(
      shouldBlockOnMissingVisibleProviderModels({
        hasAnyCachedModels: true,
        hasCachedModelsForAllVisibleProviders: true,
      }),
    ).toBe(false);
  });
});

describe("parseModelsDevCapabilities", () => {
  test("parses context and reasoning from models.dev payload", () => {
    const rows = parseModelsDevCapabilities(
      {
        openai: {
          models: {
            "gpt-5.2": {
              id: "gpt-5.2",
              limit: { context: 400_000 },
              reasoning: true,
            },
            "gpt-5.3-codex": {
              limit: { context: 400_000 },
              reasoning: true,
            },
          },
        },
      },
      123,
    );

    const byId = new Map(rows.map((row) => [row.canonical_model_id, row]));
    expect(byId.get("gpt-5.2")?.context_window).toBe(400_000);
    expect(byId.get("gpt-5.2")?.reasoning).toBe(1);
    expect(byId.get("gpt-5.3-codex")?.context_window).toBe(400_000);
    expect(byId.get("gpt-5.3-codex")?.reasoning).toBe(1);
  });

  test("normalizes repeated models/ prefixes and merges duplicate providers", () => {
    const rows = parseModelsDevCapabilities(
      {
        google: {
          models: {
            "Gemini-2.5-Pro": {
              id: "models/models/Gemini-2.5-Pro",
            },
          },
        },
        openai: {
          models: {
            "gemini-2.5-pro": {
              limit: { context: 128.9 },
              reasoning: true,
            },
          },
        },
      },
      456,
    );

    expect(rows).toEqual([
      {
        canonical_model_id: "gemini-2.5-pro",
        context_window: 128,
        max_output_tokens: null,
        reasoning: 1,
        source_provider: "google",
        raw_json: JSON.stringify({ id: "models/models/Gemini-2.5-Pro" }),
        updated_at: 456,
      },
    ]);
  });

  test("parses max_output_tokens from limit.output", () => {
    const rows = parseModelsDevCapabilities(
      {
        openai: {
          models: {
            "gpt-5.2": {
              id: "gpt-5.2",
              limit: { context: 400_000, output: 32_768 },
            },
          },
        },
      },
      123,
    );
    expect(rows[0]?.max_output_tokens).toBe(32_768);
    expect(rows[0]?.context_window).toBe(400_000);
  });

  test("sanitizes invalid context window values", () => {
    const rows = parseModelsDevCapabilities(
      {
        openai: {
          models: {
            negative: { limit: { context: -12.9 } },
            fractional: { limit: { context: 4096.9 } },
            invalid: { limit: { context: Number.NaN } },
            stringy: { limit: { context: "128000" } },
          },
        },
      },
      789,
    );

    const byId = new Map(rows.map((row) => [row.canonical_model_id, row]));
    expect(byId.get("negative")?.context_window).toBe(0);
    expect(byId.get("fractional")?.context_window).toBe(4096);
    expect(byId.get("invalid")?.context_window).toBeNull();
    expect(byId.get("stringy")?.context_window).toBeNull();
  });
});

describe("normalizeModelId", () => {
  test("trims, lowercases, and removes repeated models/ prefixes", () => {
    expect(normalizeModelId("  MODELS/models/GPT-5.2  ")).toBe("gpt-5.2");
  });
});

describe("model match index", () => {
  test("matches exact canonical ids", () => {
    const index = buildModelMatchIndex(["openai/gpt-5.2"]);
    expect(matchCanonicalModelId("OPENAI/GPT-5.2", index)).toBe(
      "openai/gpt-5.2",
    );
  });

  test("uses unique basename alias fallback", () => {
    const index = buildModelMatchIndex(["openai/gpt-5.2"]);
    expect(matchCanonicalModelId("gpt-5.2", index)).toBe("openai/gpt-5.2");
  });

  test("does not match ambiguous basename aliases", () => {
    const index = buildModelMatchIndex(["openai/gpt-5.2", "custom/gpt-5.2"]);
    expect(matchCanonicalModelId("gpt-5.2", index)).toBeNull();
  });
});

describe("staleness", () => {
  test("uses 7-day ttl", () => {
    const now = 1_000_000_000;
    expect(isStaleTimestamp(null, now)).toBe(true);
    expect(isStaleTimestamp(now - MODEL_INFO_TTL_MS + 1, now)).toBe(false);
    expect(isStaleTimestamp(now - MODEL_INFO_TTL_MS - 1, now)).toBe(true);
  });
});

describe("resolveModelInfoFromRows", () => {
  const capabilities = [
    {
      canonical_model_id: "gpt-5.2",
      context_window: 400_000,
      max_output_tokens: 16_384,
      reasoning: 1,
      source_provider: "openai",
      raw_json: null,
      updated_at: 1,
    },
  ];

  const providers = [
    {
      provider: "openai",
      provider_model_id: "gpt-5.2",
      display_name: "GPT-5.2",
      canonical_model_id: "gpt-5.2",
      context_window: null,
      free: 0,
      updated_at: 1,
    },
    {
      provider: "zen",
      provider_model_id: "gpt-5.2",
      display_name: "GPT-5.2",
      canonical_model_id: "gpt-5.2",
      context_window: 128_000,
      free: 0,
      updated_at: 1,
    },
    {
      provider: "ollama",
      provider_model_id: "qwen2.5-coder",
      display_name: "qwen2.5-coder",
      canonical_model_id: null,
      context_window: 32_768,
      free: 0,
      updated_at: 1,
    },
  ];

  test("uses canonical capabilities and provider fallback context", () => {
    expect(
      resolveModelInfoFromRows("openai/gpt-5.2", capabilities, providers),
    ).toEqual({
      canonicalModelId: "gpt-5.2",
      contextWindow: 400_000,
      maxOutputTokens: 16_384,
      reasoning: true,
    });

    expect(
      resolveModelInfoFromRows("ollama/qwen2.5-coder", capabilities, providers),
    ).toEqual({
      canonicalModelId: null,
      contextWindow: 32_768,
      maxOutputTokens: null,
      reasoning: false,
    });
  });

  test("returns same capabilities across providers for same canonical model", () => {
    const openaiInfo = resolveModelInfoFromRows(
      "openai/gpt-5.2",
      capabilities,
      providers,
    );
    const zenInfo = resolveModelInfoFromRows(
      "zen/gpt-5.2",
      capabilities,
      providers,
    );

    expect(openaiInfo).toEqual(zenInfo);
    expect(openaiInfo?.contextWindow).toBe(400_000);
    expect(openaiInfo?.maxOutputTokens).toBe(16_384);
    expect(openaiInfo?.reasoning).toBe(true);
  });

  test("falls back to provider context when canonical context is unknown", () => {
    const info = resolveModelInfoFromRows(
      "openai/gpt-5.2",
      [
        {
          canonical_model_id: "gpt-5.2",
          context_window: null,
          max_output_tokens: null,
          reasoning: 1,
          source_provider: "openai",
          raw_json: null,
          updated_at: 1,
        },
      ],
      [
        {
          provider: "openai",
          provider_model_id: "gpt-5.2",
          display_name: "GPT-5.2",
          canonical_model_id: "gpt-5.2",
          context_window: 200_000,
          free: 0,
          updated_at: 1,
        },
      ],
    );

    expect(info).toEqual({
      canonicalModelId: "gpt-5.2",
      contextWindow: 200_000,
      maxOutputTokens: null,
      reasoning: true,
    });
  });
});
