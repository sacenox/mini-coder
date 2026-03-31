import { RenderedError } from "../cli/output.ts";

interface RunWithTeardownOptions<T> {
  run: () => Promise<T>;
  teardown?: () => Promise<void>;
  renderError: (error: unknown) => void;
}

export async function runWithTeardown<T>(
  opts: RunWithTeardownOptions<T>,
): Promise<T> {
  let hasPrimaryError = false;
  let primaryError: unknown;
  let result: T | undefined;

  try {
    result = await opts.run();
  } catch (error) {
    hasPrimaryError = true;
    if (error instanceof RenderedError) {
      primaryError = error;
    } else {
      opts.renderError(error);
      primaryError = new RenderedError(error);
    }
  }

  try {
    await opts.teardown?.();
  } catch (teardownError) {
    if (!hasPrimaryError) throw teardownError;
  }

  if (hasPrimaryError) throw primaryError;
  return result as T;
}
