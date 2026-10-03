import { randomBytes } from "node:crypto";
import { hashPassword, prisma, verifyPassword } from "@ccr/database";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { pickActiveMembership, requestedOrganizationId } from "./server/auth/active-organization";
import { rememberDevice } from "./server/auth/device";
import { beginSignInAttempt, type SignInOutcome } from "./server/auth/limits";

let equalizerHash: Promise<string> | null = null;
/** A real hash of a random value, verified when the email is unknown. */
function timingEqualizerHash(): Promise<string> {
  equalizerHash ??= hashPassword(randomBytes(16).toString("hex"));
  return equalizerHash;
}

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

/**
 * Auth.js configuration. Email + password (credentials) with JWT sessions for
 * the MVP; hospital SSO (OIDC / SAML) can be added as additional providers
 * without changing the rest of the application. The session stores only the
 * identity id; the membership in the active organization is resolved on every
 * request (see server/auth/session.ts).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        // Admission happens before any await; see beginSignInAttempt.
        const attempt = beginSignInAttempt(email, request.headers);
        if (!attempt) return null;
        let outcome: SignInOutcome = "error";
        try {
          const identity = await prisma.identity.findUnique({ where: { email } });
          // Unknown emails still pay for one password check, so response time does not reveal accounts.
          const valid = await verifyPassword(password, identity?.passwordHash ?? (await timingEqualizerHash()));
          if (!identity || !valid) {
            outcome = "failure";
            return null;
          }
          outcome = "success";
          await rememberDevice(identity.email);
          return { id: identity.id, name: identity.name, email: identity.email };
        } finally {
          attempt.finish(outcome);
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (typeof token.uid === "string") session.user.id = token.uid;
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      if (!user.id) return;
      const memberships = await prisma.user.findMany({ where: { identityId: user.id } });
      const member = pickActiveMembership(memberships, await requestedOrganizationId());
      if (!member) return;
      await prisma.$transaction([
        prisma.user.update({ where: { id: member.id }, data: { lastLoginAt: new Date() } }),
        prisma.auditEvent.create({
          data: {
            organizationId: member.organizationId,
            userId: member.id,
            action: "auth.signed_in",
            resourceType: "User",
            resourceId: member.id,
          },
        }),
      ]);
    },
  },
});
