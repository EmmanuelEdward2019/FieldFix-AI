import { generateSecret, generateSync, generateURI, verifySync } from "otplib";

/**
 * TOTP helpers over otplib v13 (RFC 6238, 30s step, SHA-1, 6 digits).
 * epochTolerance 30 absorbs one step of clock skew between server
 * and the user's authenticator app.
 */
export function generateTotpSecret(): string {
  return generateSecret();
}

export function verifyTotp(secret: string, code: string): boolean {
  try {
    return verifySync({ secret, token: code.trim(), epochTolerance: 30 }).valid;
  } catch {
    return false;
  }
}

export function currentTotp(secret: string): string {
  return generateSync({ secret });
}

export function totpKeyUri(email: string, secret: string): string {
  return generateURI({ issuer: "FieldFix AI", label: email, secret });
}
