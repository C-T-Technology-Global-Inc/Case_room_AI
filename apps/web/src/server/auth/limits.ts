import { clientAddress, envLimit, namedLimiter, retryText, type RateLimiter } from "../rate-limit";
import { isKnownDevice } from "./device";

const FIFTEEN_MINUTES = 15 * 60_000;
const HOUR = 60 * 60_000;

function signInLimiters() {
  return {
    // Tight limit per email from one client: an attacker elsewhere cannot lock the real user out.
    emailFromAddress: namedLimiter("signin-email-address", envLimit("SIGNIN_ATTEMPTS_PER_EMAIL", 10), FIFTEEN_MINUTES),
    // Per client address, across emails (password spraying).
    address: namedLimiter("signin-address", envLimit("SIGNIN_ATTEMPTS_PER_IP", 50), FIFTEEN_MINUTES),
    // Per email across all clients (distributed guessing); high, so a lockout costs an attacker many attempts.
    account: namedLimiter("signin-account", envLimit("SIGNIN_ATTEMPTS_PER_ACCOUNT", 100), FIFTEEN_MINUTES),
  };
}

function signInKeys(email: string, headers: Headers) {
  const account = email.trim().toLowerCase();
  const address = clientAddress(headers);
  // Without a client address (no trusted proxy), the email-only key is all there is.
  return { account, address, emailFromAddress: `${account}|${address ?? "unknown"}` };
}

// Attempts admitted but not finished yet, per limiter scope and key (password check in progress).
const globalForSignIn = globalThis as unknown as { __ccrSignInInFlight?: Map<string, number> };
const inFlight = () => (globalForSignIn.__ccrSignInInFlight ??= new Map());

interface Scope {
  name: string;
  limiter: RateLimiter;
  key: string;
}

function signInScopes(email: string, headers: Headers): { scopes: Scope[]; account: Scope } {
  const limiters = signInLimiters();
  const keys = signInKeys(email, headers);
  const account = { name: "account", limiter: limiters.account, key: keys.account };
  const scopes: Scope[] = [{ name: "email-address", limiter: limiters.emailFromAddress, key: keys.emailFromAddress }, account];
  if (keys.address) scopes.push({ name: "address", limiter: limiters.address, key: keys.address });
  return { scopes, account };
}

const slot = (scope: Scope) => `${scope.name}|${scope.key}`;

/** Scopes that block this request: the account-wide limit does not apply to a known device of that account. */
function blockingScopes(email: string, headers: Headers): Scope[] {
  const { scopes, account } = signInScopes(email, headers);
  return isKnownDevice(headers, email) ? scopes.filter((scope) => scope !== account) : scopes;
}

export type SignInOutcome = "success" | "failure" | "error";

export interface SignInAttempt {
  /** Release the slot; a failure is counted, a success clears this email's failures. Idempotent. */
  finish(outcome: SignInOutcome): void;
}

/**
 * Admit one credentials check. Synchronous on purpose: it must run before any
 * await, so a burst of concurrent requests cannot all pass the check before the
 * first failure is recorded. A scope is full when recorded failures plus checks
 * still in progress reach its limit. Returns null when the attempt is refused
 * (the password is then not checked).
 */
export function beginSignInAttempt(email: string, headers: Headers): SignInAttempt | null {
  const { scopes } = signInScopes(email, headers);
  for (const scope of blockingScopes(email, headers)) {
    const limit = scope.limiter.limit;
    if (limit > 0 && scope.limiter.count(scope.key) + (inFlight().get(slot(scope)) ?? 0) >= limit) return null;
  }
  for (const scope of scopes) inFlight().set(slot(scope), (inFlight().get(slot(scope)) ?? 0) + 1);

  let finished = false;
  return {
    finish(outcome) {
      if (finished) return;
      finished = true;
      for (const scope of scopes) {
        const left = (inFlight().get(slot(scope)) ?? 1) - 1;
        if (left > 0) inFlight().set(slot(scope), left);
        else inFlight().delete(slot(scope));
        if (outcome === "failure") scope.limiter.consume(scope.key);
      }
      if (outcome === "success") {
        // The address counter keeps counting other emails (password spraying).
        for (const scope of scopes) if (scope.name !== "address") scope.limiter.reset(scope.key);
      }
    },
  };
}

/** User-facing message when sign-in is currently blocked for this client and email, or null. */
export function signInBlockedMessage(email: string, headers: Headers): string | null {
  const wait = Math.max(0, ...blockingScopes(email, headers).map((scope) => scope.limiter.peek(scope.key)));
  return wait ? `Too many sign-in attempts. Try again in ${retryText(wait)}.` : null;
}

/** Account creation (signup, invitation acceptance) per client address. Returns a message when blocked. */
export function consumeAccountCreation(kind: "signup" | "invite", headers: Headers): string | null {
  const address = clientAddress(headers);
  if (!address) return null;
  const limit = kind === "signup" ? envLimit("SIGNUPS_PER_IP_PER_HOUR", 5) : envLimit("INVITE_ACCEPTS_PER_IP_PER_HOUR", 10);
  const wait = namedLimiter(`account-${kind}`, limit, HOUR).consume(address);
  return wait ? `Too many attempts from this network. Try again in ${retryText(wait)}.` : null;
}
