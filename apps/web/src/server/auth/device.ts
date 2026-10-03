import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Device cookie (OWASP "slow down online guessing attacks with device
 * cookies"): after a successful sign-in, the browser keeps an HMAC-signed list
 * of the accounts that signed in on it. A browser that proves it is a known
 * device for an email is exempt from the account-wide failure limit, so an
 * attacker spreading wrong passwords over many addresses cannot lock the owner
 * out of their usual browser. The cookie holds keyed hashes, not emails.
 */
export const DEVICE_COOKIE = "ccr-device";
const MAX_ACCOUNTS = 5;
const MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

function secret(): string {
  return process.env.AUTH_SECRET ?? "";
}

function accountMark(email: string): string {
  return createHmac("sha256", secret()).update(`device-account:${email.trim().toLowerCase()}`).digest("base64url").slice(0, 22);
}

function signature(payload: string): string {
  return createHmac("sha256", secret()).update(`device-cookie:${payload}`).digest("base64url");
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  for (const part of cookieHeader?.split(";") ?? []) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** Account marks from a valid, unexpired device cookie value (empty when absent, tampered or expired). */
export function deviceMarks(value: string | null | undefined, now = Date.now()): string[] {
  if (!value || !secret()) return [];
  const [payload, mac] = value.split(".");
  if (!payload || !mac) return [];
  const expected = Buffer.from(signature(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return [];
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { m?: unknown; t?: unknown };
    if (typeof data.t !== "number" || now - data.t * 1000 > MAX_AGE_SECONDS * 1000) return [];
    return Array.isArray(data.m) ? data.m.filter((m): m is string => typeof m === "string") : [];
  } catch {
    return [];
  }
}

/** True when the request comes from a browser where this email signed in before. */
export function isKnownDevice(headers: Headers, email: string): boolean {
  if (!secret()) return false;
  return deviceMarks(readCookie(headers.get("cookie"), DEVICE_COOKIE)).includes(accountMark(email));
}

/** Cookie value that adds `email` to the device's known accounts (most recent first). */
export function deviceCookieValue(existing: string | null | undefined, email: string, now = Date.now()): string {
  const mark = accountMark(email);
  const marks = [mark, ...deviceMarks(existing, now).filter((m) => m !== mark)].slice(0, MAX_ACCOUNTS);
  const payload = Buffer.from(JSON.stringify({ m: marks, t: Math.floor(now / 1000) })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

/** After a successful sign-in: remember this browser for the account. Best effort. */
export async function rememberDevice(email: string): Promise<void> {
  if (!secret()) return;
  try {
    const store = await cookies();
    store.set(DEVICE_COOKIE, deviceCookieValue(store.get(DEVICE_COOKIE)?.value, email), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: MAX_AGE_SECONDS,
    });
  } catch {
    // Outside a request that can set cookies; the next sign-in will try again.
  }
}
