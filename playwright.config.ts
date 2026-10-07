import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { e2eDatabaseUrl } from "./tests/e2e/database";

/**
 * End-to-end tests: the production build against a dedicated database
 * (E2E_DATABASE_URL, name ending in _e2e), with the offline demo AI.
 * Run with `npm run test:e2e` (builds first). See CONTRIBUTING.md.
 */
loadEnv({ path: path.resolve(process.cwd(), ".env"), quiet: true });

const port = Number(process.env.E2E_PORT ?? 3200);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  // One database and one server: tests run one at a time. No retries, so flaky tests surface.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run start -w @ccr/web -- -p ${port} -H 127.0.0.1`,
    // Liveness only: the database is migrated and seeded by globalSetup.
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: e2eDatabaseUrl(),
      AUTH_SECRET: process.env.AUTH_SECRET || "e2e-only-placeholder-secret",
      AI_PROVIDER: "demo",
      APP_URL: baseURL,
      AUTH_URL: baseURL,
      DEMO_LOGIN: "true",
      STORAGE_DIR: path.resolve(process.cwd(), "test-results/e2e-storage"),
    },
  },
});
