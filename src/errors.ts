/**
 * Shared error-formatting helpers.
 *
 * @module
 */

/**
 * Convert an unknown thrown value into a readable message string.
 *
 * @param error - The thrown value to format.
 * @returns The error message when available, otherwise the stringified value.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
