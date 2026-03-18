export function extractObjectMessage(error: object): string | null {
	const record = error as Record<string, unknown>;
	const direct = record.message;
	if (typeof direct === "string" && direct.trim()) return direct.trim();

	const nested = record.error;
	if (typeof nested === "object" && nested !== null) {
		const nestedMessage = (nested as Record<string, unknown>).message;
		if (typeof nestedMessage === "string" && nestedMessage.trim()) {
			return nestedMessage.trim();
		}
	}

	return null;
}

function stringifyUnknown(error: unknown): string {
	if (error === null || error === undefined) return "Unknown error";
	if (typeof error === "string") {
		const message = error.trim();
		return message || "Unknown error";
	}
	if (
		typeof error === "number" ||
		typeof error === "boolean" ||
		typeof error === "bigint"
	) {
		return String(error);
	}
	if (typeof error !== "object") return "Unknown error";

	const objectMessage = extractObjectMessage(error);
	if (objectMessage) return objectMessage;

	try {
		const value = JSON.stringify(error);
		if (!value || value === "{}") return "Unknown error";
		const maxLen = 500;
		return value.length > maxLen ? `${value.slice(0, maxLen - 1)}…` : value;
	} catch {
		return "Unknown error";
	}
}

export function normalizeUnknownError(error: unknown): Error {
	if (error instanceof Error) return error;
	return new Error(stringifyUnknown(error));
}
