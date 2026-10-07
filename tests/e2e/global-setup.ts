import { execFileSync } from "node:child_process";
import path from "node:path";
import { e2eDatabaseUrl } from "./database";

/** Bring the end-to-end database to the current schema and load the synthetic demo data. */
export default function globalSetup() {
  const env = { ...process.env, DATABASE_URL: e2eDatabaseUrl() };
  const database = path.resolve(process.cwd(), "packages/database");
  execFileSync("npx", ["prisma", "migrate", "deploy"], { cwd: database, env, stdio: "pipe" });
  execFileSync("npm", ["run", "db:seed"], { cwd: database, env, stdio: "pipe" });
}
