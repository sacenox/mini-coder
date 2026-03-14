import { expect, test } from "bun:test";
import {
	APICallError,
	LoadAPIKeyError,
	NoContentGeneratedError,
	NoSuchModelError,
	RetryError,
} from "ai";
import { parseAppError } from "./error-parse.ts";

test("parseAppError - string", () => {
	expect(parseAppError("hello world")).toEqual({ headline: "hello world" });
});

test("parseAppError - APICallError 429", () => {
	const err = new APICallError({
		message: "Too many",
		statusCode: 429,
		url: "https://api.example.com",
		requestBodyValues: {},
	});
	expect(parseAppError(err)).toEqual({
		headline: "Rate limit hit",
		hint: "Wait a moment and retry, or switch model with /model",
	});
});

test("parseAppError - APICallError context_length_exceeded", () => {
	const err = new APICallError({
		message:
			"This model's maximum context length is 128000 tokens. context_length_exceeded",
		statusCode: 400,
		url: "https://api.example.com",
		requestBodyValues: {},
	});
	expect(parseAppError(err)).toEqual({
		headline: "Max context size reached",
		hint: "Use /context prune to reduce history, or /new to start fresh",
	});
});

test("parseAppError - APICallError request too large", () => {
	const err = new APICallError({
		message: "Request too large for model",
		statusCode: 400,
		url: "https://api.example.com",
		requestBodyValues: {},
	});
	expect(parseAppError(err)).toEqual({
		headline: "Max context size reached",
		hint: "Use /context prune to reduce history, or /new to start fresh",
	});
});

test("parseAppError - APICallError 401", () => {
	const err = new APICallError({
		message: "Unauthorized",
		statusCode: 401,
		url: "https://api.example.com",
		requestBodyValues: {},
	});
	expect(parseAppError(err)).toEqual({
		headline: "Auth failed",
		hint: "Check the relevant provider API key env var",
	});
});

test("parseAppError - APICallError generic", () => {
	const err = new APICallError({
		message: "Bad Gateway",
		statusCode: 502,
		url: "https://api.example.com",
		requestBodyValues: {},
	});
	expect(parseAppError(err)).toEqual({
		headline: "API error 502",
		hint: "https://api.example.com",
	});
});

test("parseAppError - RetryError", () => {
	const inner = new APICallError({
		message: "Rate limit",
		statusCode: 429,
		url: "https://api.example.com",
		requestBodyValues: {},
	});
	const err = new RetryError({
		message: "Retries failed",
		reason: "maxRetriesExceeded",
		errors: [inner],
	});
	expect(parseAppError(err)).toEqual({
		headline: "Retries exhausted: Rate limit hit",
		hint: "Wait a moment and retry, or switch model with /model",
	});
});

test("parseAppError - NoContentGeneratedError", () => {
	const err = new NoContentGeneratedError({ message: "Empty" });
	expect(parseAppError(err)).toEqual({
		headline: "Model returned empty response",
		hint: "Try rephrasing or switching model with /model",
	});
});

test("parseAppError - LoadAPIKeyError", () => {
	const err = new LoadAPIKeyError({ message: "Missing key" });
	expect(parseAppError(err)).toEqual({
		headline: "API key not found",
		hint: "Set the relevant provider env var",
	});
});

test("parseAppError - NoSuchModelError", () => {
	const err = new NoSuchModelError({
		modelId: "gpt-4",
		modelType: "languageModel",
	});
	expect(parseAppError(err)).toEqual({
		headline: "Model not found",
		hint: "Use /model to pick a valid model",
	});
});

test("parseAppError - ECONNREFUSED code", () => {
	const err = Object.assign(new Error("Boom"), { code: "ECONNREFUSED" });
	expect(parseAppError(err)).toEqual({
		headline: "Connection failed",
		hint: "Check network or local server",
	});
});

test("parseAppError - ECONNREFUSED message", () => {
	const err = new Error("fetch failed: ECONNREFUSED 127.0.0.1:11434");
	expect(parseAppError(err)).toEqual({
		headline: "Connection failed",
		hint: "Check network or local server",
	});
});

test("parseAppError - ECONNRESET code", () => {
	const err = Object.assign(new Error("Connection reset"), {
		code: "ECONNRESET",
	});
	expect(parseAppError(err)).toEqual({
		headline: "Connection lost",
		hint: "The server closed the connection — retry or switch model with /model",
	});
});

test("parseAppError - socket closed unexpectedly message", () => {
	const err = new Error(
		"The socket connection was closed unexpectedly. For more information, pass `verbose: true`",
	);
	expect(parseAppError(err)).toEqual({
		headline: "Connection lost",
		hint: "The server closed the connection — retry or switch model with /model",
	});
});

test("parseAppError - fallback", () => {
	const err = new Error("Something went wrong\nSome more details");
	expect(parseAppError(err)).toEqual({
		headline: "Something went wrong",
	});
});
