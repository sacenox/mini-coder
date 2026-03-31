import { afterAll, describe, expect, test } from "bun:test";
import {
  discoverProviderConnections,
  getLocalProviderNames,
  getVisibleProviders,
  LOCAL_PROVIDER_CACHE_TTL_MS,
  refreshLocalProviderConnections,
} from "./provider-discovery.ts";

const servers: Array<{ stop: () => void }> = [];

afterAll(() => {
  for (const server of servers) server.stop();
});

describe("provider-discovery", () => {
  test("detects reachable ollama and exposes it as visible + connected", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/api/tags") {
          return Response.json({ models: [] });
        }
        return new Response("not found", { status: 404 });
      },
    });
    servers.push(server);
    const env = { OLLAMA_BASE_URL: server.url.origin };

    const localProviders = await refreshLocalProviderConnections(env);
    expect(localProviders).toEqual(["ollama"]);
    expect(getVisibleProviders(env)).toContain("ollama");
    await expect(discoverProviderConnections(env)).resolves.toContainEqual({
      name: "ollama",
      via: "local",
    });
  });

  test("does not report unreachable ollama as visible or connected", async () => {
    const env = { OLLAMA_BASE_URL: "http://127.0.0.1:9" };

    const localProviders = await refreshLocalProviderConnections(env);
    expect(localProviders).toEqual([]);
    expect(getVisibleProviders(env)).not.toContain("ollama");
    await expect(discoverProviderConnections(env)).resolves.toEqual([]);
  });

  test("expires stale local provider visibility after the cache ttl", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/api/tags") {
          return Response.json({ models: [] });
        }
        return new Response("not found", { status: 404 });
      },
    });
    servers.push(server);
    const env = { OLLAMA_BASE_URL: server.url.origin };
    const refreshedAt = 1_000;

    await refreshLocalProviderConnections(env, refreshedAt);
    expect(getVisibleProviders({}, { now: refreshedAt })).toContain("ollama");
    expect(
      getVisibleProviders(
        {},
        { now: refreshedAt + LOCAL_PROVIDER_CACHE_TTL_MS + 1 },
      ),
    ).not.toContain("ollama");
  });

  test("extracts local provider names from a shared discovery result", () => {
    expect(
      getLocalProviderNames([
        { name: "openai", via: "oauth" },
        { name: "ollama", via: "local" },
        { name: "zen", via: "env" },
      ]),
    ).toEqual(["ollama"]);
  });
});
