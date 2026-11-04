import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function scryptKey(
  password: string,
  salt: Buffer,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, options, (err, key) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(key as Buffer);
    });
  });
}

/**
 * Password hashing with scrypt (NIST-approved KDF, per-user random
 * salt). Stored format: `scrypt$<N>$<r>$<p>$<salt-hex>$<hash-hex>`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptKey(password, salt, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }
  const [, n, r, p, saltHex, hashHex] = parts as [string, string, string, string, string, string];
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length !== SALT_LENGTH || expected.length !== KEY_LENGTH) {
    return false;
  }
  const derived = await scryptKey(password, salt, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(derived, expected);
}
