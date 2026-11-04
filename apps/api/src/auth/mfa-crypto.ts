import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope for TOTP secrets at rest. The key comes from
 * MFA_ENCRYPTION_KEY (64 hex chars); without it, MFA enrollment is
 * unavailable rather than stored in plaintext. Format: base64(iv || tag || ct).
 */
export function parseMfaKey(raw: string | undefined): Buffer | null {
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    return null;
  }
  return Buffer.from(raw, "hex");
}

export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptSecret(key: Buffer, blob: string): string {
  const raw = Buffer.from(blob, "base64");
  if (raw.length < 12 + 16 + 1) {
    throw new Error("malformed secret envelope");
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
