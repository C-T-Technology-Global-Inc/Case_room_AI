import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env at the repository root.");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.PRISMA_LOG_QUERIES === "true" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

// One client per process, reused across hot reloads in development.
const globalForPrisma = globalThis as unknown as { __ccrPrisma?: PrismaClient };

function getClient(): PrismaClient {
  globalForPrisma.__ccrPrisma ??= createPrismaClient();
  return globalForPrisma.__ccrPrisma;
}

/**
 * Lazily-initialized Prisma client: the connection is created on first use,
 * not at import time, so environment variables can be loaded by the host
 * (Next.js instrumentation, seed scripts) before the database is touched.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient();
    const value = Reflect.get(client, property, client) as unknown;
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
});

export type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

/** Either the root client or an interactive-transaction client. */
export type DbClient = PrismaClient | TransactionClient;
