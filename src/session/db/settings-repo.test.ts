import { describe, expect, test } from "bun:test";
import { parseBooleanSetting } from "./settings-repo.ts";

describe("parseBooleanSetting", () => {
	test("uses fallback for null and unknown values", () => {
		expect(parseBooleanSetting(null, false)).toBe(false);
		expect(parseBooleanSetting(null, true)).toBe(true);
		expect(parseBooleanSetting("unexpected", false)).toBe(false);
		expect(parseBooleanSetting("unexpected", true)).toBe(true);
	});

	test("accepts common true and false representations", () => {
		expect(parseBooleanSetting("true", false)).toBe(true);
		expect(parseBooleanSetting("on", false)).toBe(true);
		expect(parseBooleanSetting("1", false)).toBe(true);
		expect(parseBooleanSetting("false", true)).toBe(false);
		expect(parseBooleanSetting("off", true)).toBe(false);
		expect(parseBooleanSetting("0", true)).toBe(false);
	});
});
