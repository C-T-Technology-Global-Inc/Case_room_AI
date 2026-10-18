import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";
import { migrationUrl } from "./prisma/migration-url";

// A single `.env` at the repository root is shared by the web app and this
// package. Prisma commands run from `packages/database`, so look there first
// and then at the monorepo root.
loadEnv({
  path: [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "../../.env")],
  quiet: true,
});

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed/index.ts",
  },
  datasource: {
    // Same database as the app, with its SSL options in Prisma's format.
    url: migrationUrl(env("DATABASE_URL")),
  },
});
