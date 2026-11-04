import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { StorageError, StorageNotFoundError, type StorageAdapter } from "./types.js";

/**
 * Filesystem-backed storage for local development and tests. Layout:
 * `<root>/<key>`, where keys look like
 * `evidence/<sessionId>/<fileId>/<filename>`.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly driver = "local";

  constructor(private readonly rootDir: string) {}

  async put(key: string, data: Buffer, _mediaType: string): Promise<void> {
    const target = this.resolve(key);
    try {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data);
    } catch (err) {
      throw new StorageError(`failed to store object: ${key}`, { cause: err });
    }
  }

  async get(key: string): Promise<Buffer> {
    const target = this.resolve(key);
    try {
      return await readFile(target);
    } catch (err) {
      if (isNotFound(err)) {
        throw new StorageNotFoundError(key);
      }
      throw new StorageError(`failed to read object: ${key}`, { cause: err });
    }
  }

  async delete(key: string): Promise<void> {
    const target = this.resolve(key);
    try {
      await rm(target, { force: true });
    } catch (err) {
      throw new StorageError(`failed to delete object: ${key}`, { cause: err });
    }
  }

  /** Resolve a key strictly inside the root (rejects traversal). */
  private resolve(key: string): string {
    if (key.length === 0 || key.length > 1024) {
      throw new StorageError(`invalid storage key: ${key}`);
    }
    const target = path.resolve(this.rootDir, key);
    const root = path.resolve(this.rootDir) + path.sep;
    if (!target.startsWith(root)) {
      throw new StorageError(`storage key escapes root: ${key}`);
    }
    return target;
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}
