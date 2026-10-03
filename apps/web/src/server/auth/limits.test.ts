import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEVICE_COOKIE, deviceCookieValue, deviceMarks, isKnownDevice } from "./device";
import { beginSignInAttempt, signInBlockedMessage } from "./limits";

const from = (address: string, cookie?: string) =>
  new Headers({ "x-forwarded-for": address, ...(cookie ? { cookie: `${DEVICE_COOKIE}=${cookie}` } : {}) });
let counter = 0;
const freshEmail = () => `person${++counter}@test.invalid`;

/** Admit and immediately finish `n` attempts with the given outcome. */
function attempts(n: number, email: string, headers: Headers, outcome: "success" | "failure" | "error") {
  for (let i = 0; i < n; i++) {
    const attempt = beginSignInAttempt(email, headers);
    if (!attempt) throw new Error(`attempt ${i + 1} was refused`);
    attempt.finish(outcome);
  }
}

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "test-secret-for-device-cookies");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sign-in admission", () => {
  it("blocks the client that keeps failing, not the real user elsewhere", () => {
    const email = freshEmail();
    attempts(10, email, from("203.0.113.1"), "failure");
    expect(beginSignInAttempt(email, from("203.0.113.1"))).toBeNull();
    expect(signInBlockedMessage(email, from("203.0.113.1"))).toMatch(/Too many sign-in attempts/);
    expect(beginSignInAttempt(email, from("198.51.100.7"))).not.toBeNull();
  });

  it("counts checks still in progress, so a concurrent burst cannot exceed the limit (round 3 finding 1)", () => {
    const email = freshEmail();
    const pending = Array.from({ length: 10 }, () => beginSignInAttempt(email, from("203.0.113.5")));
    expect(pending.every(Boolean)).toBe(true);
    // The 11th is refused before any password check, although no failure is recorded yet.
    expect(beginSignInAttempt(email, from("203.0.113.5"))).toBeNull();

    // An attempt that ends in an error (or success) gives its slot back without counting a failure.
    pending[0]!.finish("error");
    const next = beginSignInAttempt(email, from("203.0.113.5"));
    expect(next).not.toBeNull();
    next!.finish("error");

    for (const attempt of pending.slice(1)) attempt!.finish("failure");
    expect(beginSignInAttempt(email, from("203.0.113.5"))).not.toBeNull(); // 9 failures recorded
  });

  it("forgets an email's failures after a correct password", () => {
    const email = freshEmail();
    attempts(9, email, from("203.0.113.3"), "failure");
    attempts(1, email, from("203.0.113.3"), "success");
    attempts(9, email, from("203.0.113.3"), "failure");
    expect(beginSignInAttempt(email, from("203.0.113.3"))).not.toBeNull();
  });

  it("limits password spraying from one address across emails", () => {
    vi.stubEnv("SIGNIN_ATTEMPTS_PER_IP", "3");
    for (let i = 0; i < 3; i++) attempts(1, freshEmail(), from("203.0.113.2"), "failure");
    expect(beginSignInAttempt(freshEmail(), from("203.0.113.2"))).toBeNull();
  });
});

describe("account-wide limit and known devices (round 3 finding 6)", () => {
  it("blocks unknown browsers after distributed guessing, but not the owner's known browser", () => {
    vi.stubEnv("SIGNIN_ATTEMPTS_PER_ACCOUNT", "5");
    const email = freshEmail();
    const ownerCookie = deviceCookieValue(null, email);
    for (let i = 0; i < 5; i++) attempts(1, email, from(`192.0.2.${i + 10}`), "failure");

    expect(beginSignInAttempt(email, from("192.0.2.200"))).toBeNull();
    const owner = beginSignInAttempt(email, from("192.0.2.201", ownerCookie));
    expect(owner).not.toBeNull();
    owner!.finish("success");
    // The owner's success clears the account-wide counter for everyone.
    expect(beginSignInAttempt(email, from("192.0.2.200"))).not.toBeNull();
  });

  it("still applies the per-client limit to a known browser", () => {
    const email = freshEmail();
    const cookie = deviceCookieValue(null, email);
    attempts(10, email, from("203.0.113.8", cookie), "failure");
    expect(beginSignInAttempt(email, from("203.0.113.8", cookie))).toBeNull();
  });
});

describe("device cookie", () => {
  it("recognizes only signed, unexpired cookies for that email", () => {
    const email = freshEmail();
    const value = deviceCookieValue(null, email);
    expect(isKnownDevice(from("192.0.2.1", value), email)).toBe(true);
    expect(isKnownDevice(from("192.0.2.1", value), freshEmail())).toBe(false);

    const [payload] = value.split(".");
    expect(isKnownDevice(from("192.0.2.1", `${payload}.forged-signature`), email)).toBe(false);

    const old = deviceCookieValue(null, email, Date.now() - 200 * 86_400_000);
    expect(deviceMarks(old)).toEqual([]);
  });

  it("keeps several accounts, most recent first, and stores no email in clear", () => {
    const first = freshEmail();
    const second = freshEmail();
    const value = deviceCookieValue(deviceCookieValue(null, first), second);
    expect(isKnownDevice(from("192.0.2.1", value), first)).toBe(true);
    expect(isKnownDevice(from("192.0.2.1", value), second)).toBe(true);
    expect(Buffer.from(value.split(".")[0]!, "base64url").toString("utf8")).not.toContain("@");
  });
});
