import { describe, expect, test } from "bun:test";
import { extractAccountId } from "./openai.ts";

describe("extractAccountId", () => {
  test("extracts account ID from a valid JWT", () => {
    const payload = {
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_abc123",
      },
    };
    const header = btoa(JSON.stringify({ alg: "RS256" }));
    const body = btoa(JSON.stringify(payload));
    const token = `${header}.${body}.fake-sig`;
    expect(extractAccountId(token)).toBe("acct_abc123");
  });

  test("returns null for a JWT without the claim", () => {
    const payload = { sub: "user123" };
    const header = btoa(JSON.stringify({ alg: "RS256" }));
    const body = btoa(JSON.stringify(payload));
    const token = `${header}.${body}.fake-sig`;
    expect(extractAccountId(token)).toBeNull();
  });

  test("returns null for non-JWT strings", () => {
    expect(extractAccountId("sk-abc123")).toBeNull();
    expect(extractAccountId("")).toBeNull();
  });
});
