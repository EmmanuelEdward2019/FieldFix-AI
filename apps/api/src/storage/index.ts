import path from "node:path";
import type { AppEnv } from "../env.js";
import { LocalStorageAdapter } from "./local-adapter.js";
import type { StorageAdapter } from "./types.js";

export * from "./types.js";

/** Resolve the storage root: explicit dir or apps/api/.storage. */
export function resolveStorageDir(env: AppEnv): string {
  if (env.STORAGE_DIR) {
    return path.resolve(env.STORAGE_DIR);
  }
  return path.resolve(__dirname, "..", "..", ".storage");
}

export function createStorageFromEnv(env: AppEnv): StorageAdapter {
  switch (env.STORAGE_DRIVER) {
    case "local":
      return new LocalStorageAdapter(resolveStorageDir(env));
  }
}
