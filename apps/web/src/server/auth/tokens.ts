import { createHash, randomBytes } from "node:crypto";

/**
 * Secret link tokens (password reset, signup confirmation). The token goes in
 * the emailed link; only its SHA-256 hash is stored, so the database alone
 * never yields a working link. 32 random bytes need no slow hash.
 */
export function newLinkToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashLinkToken(token) };
}

export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
