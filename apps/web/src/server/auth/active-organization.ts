import { cookies } from "next/headers";

/**
 * The organization a signed-in person is working in. A person (identity) can
 * belong to several organizations; the active one is chosen per browser with
 * this cookie and re-validated against the person's memberships on every request.
 */
export const ACTIVE_ORGANIZATION_COOKIE = "ccr-org";

export const ACTIVE_ORGANIZATION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};

interface MembershipChoice {
  organizationId: string;
  lastLoginAt: Date | null;
  createdAt: Date;
}

/** The requested organization if the person belongs to it, otherwise the one they used most recently. */
export function pickActiveMembership<T extends MembershipChoice>(memberships: readonly T[], requestedOrganizationId: string | undefined): T | null {
  const requested = memberships.find((m) => m.organizationId === requestedOrganizationId);
  if (requested) return requested;
  const recency = (m: T) => (m.lastLoginAt ?? m.createdAt).getTime();
  return [...memberships].sort((a, b) => recency(b) - recency(a) || a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;
}

/** Organization id from the cookie, or undefined outside a request (or when unset). */
export async function requestedOrganizationId(): Promise<string | undefined> {
  try {
    return (await cookies()).get(ACTIVE_ORGANIZATION_COOKIE)?.value;
  } catch {
    return undefined;
  }
}
