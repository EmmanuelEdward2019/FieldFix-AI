/** Errors raised by storage adapters (never leak internals to clients). */
export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageError";
  }
}

export class StorageNotFoundError extends StorageError {
  constructor(key: string) {
    super(`object not found: ${key}`);
    this.name = "StorageNotFoundError";
  }
}

/**
 * Private object-storage interface. Implementations must never expose
 * objects publicly — downloads go through an authorized API route.
 */
export interface StorageAdapter {
  readonly driver: string;
  put(key: string, data: Buffer, mediaType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
