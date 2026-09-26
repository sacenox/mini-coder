import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";

/** The `auth.json` layout: one credential per provider id. */
type AuthFile = Record<string, Credential>;

function readFile(path: string): AuthFile {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AuthFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

/** Write the whole file atomically: temp file, then rename over the target. */
function writeFile(path: string, data: AuthFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(temp, path);
}

/**
 * File-backed `CredentialStore` over `auth.json`. Writes are serialized per
 * provider through an in-process promise chain, so `modify` and `delete` on
 * the same provider never interleave.
 */
export function createCredentialStore(path: string): CredentialStore {
  const chains = new Map<string, Promise<unknown>>();

  function enqueue<T>(providerId: string, task: () => Promise<T>, options?: AuthOperationOptions): Promise<T> {
    options?.signal?.throwIfAborted();
    const previous = chains.get(providerId) ?? Promise.resolve();
    const queued = (async () => {
      await previous.catch(() => {});
      options?.signal?.throwIfAborted();
      return await task();
    })();
    const tail = queued.catch(() => {});
    chains.set(providerId, tail);
    void tail.then(() => {
      if (chains.get(providerId) === tail) chains.delete(providerId);
    });
    return queued;
  }

  return {
    async read(providerId, options): Promise<Credential | undefined> {
      options?.signal?.throwIfAborted();
      return readFile(path)[providerId];
    },
    async list(options): Promise<readonly CredentialInfo[]> {
      options?.signal?.throwIfAborted();
      return Object.entries(readFile(path)).map(([providerId, credential]) => ({ providerId, type: credential.type }));
    },
    modify(providerId, fn, options): Promise<Credential | undefined> {
      return enqueue(
        providerId,
        async () => {
          const data = readFile(path);
          const next = await fn(data[providerId]);
          options?.signal?.throwIfAborted();
          if (next !== undefined) data[providerId] = next;
          writeFile(path, data);
          return next ?? data[providerId];
        },
        options,
      );
    },
    delete(providerId, options): Promise<void> {
      return enqueue(
        providerId,
        async () => {
          const data = readFile(path);
          delete data[providerId];
          writeFile(path, data);
        },
        options,
      );
    },
  };
}
