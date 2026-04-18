/**
 * Shared runtime record/primitive readers used across the app.
 *
 * @module
 */

/** Convert an unknown value into a plain record, rejecting arrays and null. */
export function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Read a string field from a record, returning null for missing or invalid values. */
export function readString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

/** Read a boolean field from a record, returning null for missing or invalid values. */
export function readBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

/** Read a finite numeric field from a record, returning null for missing or invalid values. */
export function readFiniteNumber(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
