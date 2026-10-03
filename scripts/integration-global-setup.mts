import { execFileSync } from "node:child_process";
import path from "node:path";

/** Bring the integration test database up to the current schema before any test runs. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: path.resolve(import.meta.dirname, "../packages/database"),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
