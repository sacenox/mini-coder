import { describe, expect, test } from "bun:test";
import {
  getOAuthProvider,
  getOAuthProviders,
  isLoggedIn,
} from "./auth-storage.ts";

describe("OAuth provider registry", () => {
  test("lists only supported OAuth providers", () => {
    expect(getOAuthProviders().map((provider) => provider.id)).toEqual([
      "openai",
    ]);
    expect(getOAuthProvider("openai")?.id).toBe("openai");
    expect(getOAuthProvider("anthropic")).toBeUndefined();
  });

  test("does not expose anthropic login state through the registry", () => {
    expect(getOAuthProvider("anthropic")).toBeUndefined();
    expect(isLoggedIn("anthropic")).toBe(false);
  });
});
