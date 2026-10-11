import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string; sessionVersion?: number } & DefaultSession["user"];
  }
  interface User {
    sessionVersion?: number;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
    /** Identity.sessionVersion at sign-in (see server/auth/session.ts). */
    sv?: number;
  }
}
