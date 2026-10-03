import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const PREFIX = "scrypt";

/** Hash a password with scrypt and a random salt: `scrypt$<salt>$<hash>` (hex). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `${PREFIX}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** Constant-time verification of a password against a stored scrypt hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [prefix, saltHex, hashHex] = stored.split("$");
  if (prefix !== PREFIX || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const derived = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
