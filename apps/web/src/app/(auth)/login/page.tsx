import { prisma } from "@ccr/database";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safePath } from "@/lib/safe-path";
import { getSessionUser } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl } = await searchParams;
  if (await getSessionUser()) redirect(safePath(callbackUrl));

  // Demo accounts are listed only for the synthetic demo organization.
  const demoAccounts =
    process.env.DEMO_LOGIN === "false"
      ? []
      : await prisma.user.findMany({
          where: { email: { endsWith: "@riverside.demo" }, organization: { name: { startsWith: "Riverside" } } },
          select: { id: true, name: true, email: true, title: true, role: true },
          orderBy: { createdAt: "asc" },
        });

  return <LoginForm callbackUrl={safePath(callbackUrl)} demoAccounts={demoAccounts} />;
}
