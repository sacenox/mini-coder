import { describe, expect, test } from "bun:test";
import { generatePKCE } from "./pkce.ts";

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

describe("generatePKCE", () => {
  test("produces base64url verifier and challenge", async () => {
    const { verifier, challenge } = await generatePKCE();

    expect(verifier).toMatch(BASE64URL_RE);
    expect(challenge).toMatch(BASE64URL_RE);
    expect(verifier.length).toBeGreaterThan(0);
    expect(challenge.length).toBeGreaterThan(0);
  });

  test("challenge differs from verifier", async () => {
    const { verifier, challenge } = await generatePKCE();
    expect(challenge).not.toBe(verifier);
  });

  test("produces unique verifiers", async () => {
    const a = await generatePKCE();
    const b = await generatePKCE();
    expect(a.verifier).not.toBe(b.verifier);
  });
});
