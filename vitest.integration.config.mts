import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

/**
 * Integration tests: services against a real PostgreSQL database (row locks,
 * transactions, constraints). They use TEST_DATABASE_URL, never DATABASE_URL,
 * and refuse to run unless the database name ends in `_test`, because every
 * test truncates all tables.
 */
loadEnv({ path: path.resolve(import.meta.dirname, ".env"), quiet: true });

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error("Set TEST_DATABASE_URL (a separate database whose name ends in _test) to run integration tests.");
}
/** host:port/database, so two URLs with different credentials or options still compare equal. */
function target(value: string) {
  const parsed = new URL(value);
  const host = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname) ? "localhost" : parsed.hostname.toLowerCase();
  return `${host}:${parsed.port || "5432"}/${decodeURIComponent(parsed.pathname.replace(/^\//, ""))}`;
}
if (!target(url).endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must point to a database whose name ends in _test: integration tests erase all data.");
}
if (process.env.DATABASE_URL && target(process.env.DATABASE_URL) === target(url)) {
  throw new Error("TEST_DATABASE_URL points to the same database as DATABASE_URL. Use a separate test database.");
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "apps/web/src"),
      "server-only": path.resolve(import.meta.dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    include: ["apps/web/src/**/*.integration.test.ts"],
    environment: "node",
    globalSetup: ["./scripts/integration-global-setup.mts"],
    // One database: test files must not interleave.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: { DATABASE_URL: url, AI_PROVIDER: "demo" },
  },
});
