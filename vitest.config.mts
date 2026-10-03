import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "apps/web/src"),
      // `server-only` throws outside React Server Components; tests import server modules directly.
      "server-only": path.resolve(import.meta.dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/web/src/**/*.test.ts"],
    // Database tests run separately: `npm run test:integration` (vitest.integration.config.mts).
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
    environment: "node",
  },
});
