import { describe, expect, test } from "bun:test";
import {
	getSubagentControlAction,
	getTurnControlAction,
} from "./input-control.ts";

describe("getTurnControlAction", () => {
	test("returns cancel for ESC key", () => {
		expect(getTurnControlAction(new Uint8Array([0x1b]))).toBe("cancel");
	});

	test("returns quit for CTRL+C", () => {
		expect(getTurnControlAction(new Uint8Array([0x03]))).toBe("quit");
	});

	test("returns quit for CTRL+D", () => {
		expect(getTurnControlAction(new Uint8Array([0x04]))).toBe("quit");
	});

	test("returns null for other input", () => {
		expect(getTurnControlAction(new Uint8Array([0x61]))).toBeNull();
	});

	test("detects CTRL+C in multi-byte input", () => {
		expect(getTurnControlAction(new Uint8Array([0x61, 0x03, 0x62]))).toBe(
			"quit",
		);
	});

	test("does not trigger cancel for ESC in multi-byte input", () => {
		expect(getTurnControlAction(new Uint8Array([0x61, 0x1b, 0x62]))).toBeNull();
	});
});

describe("getSubagentControlAction", () => {
	test("returns quit for CTRL+C", () => {
		expect(getSubagentControlAction(new Uint8Array([0x03]))).toBe("quit");
	});

	test("returns quit for CTRL+D", () => {
		expect(getSubagentControlAction(new Uint8Array([0x04]))).toBe("quit");
	});

	test("returns cancel for ESC key", () => {
		expect(getSubagentControlAction(new Uint8Array([0x1b]))).toBe("cancel");
	});

	test("returns cancel for ESC in multi-byte input", () => {
		expect(getSubagentControlAction(new Uint8Array([0x61, 0x1b, 0x62]))).toBe(
			"cancel",
		);
	});

	test("prioritizes quit over cancel", () => {
		expect(getSubagentControlAction(new Uint8Array([0x1b, 0x03]))).toBe("quit");
	});
});
