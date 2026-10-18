import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import pg from "pg";
import { e2eDatabaseUrl } from "./database";

export const DEMO_PASSWORD = "demo1234";

/** One query against the end-to-end database (fixture lookups only; tests act through the UI). */
export async function queryOne<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const client = new pg.Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    const result = await client.query<T>(sql, params);
    if (!result.rows[0]) throw new Error(`No row for: ${sql}`);
    return result.rows[0];
  } finally {
    await client.end();
  }
}

export async function caseIdOf(patientLastName: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `SELECT c.id FROM "CaseRoom" c JOIN "Patient" p ON p.id = c."patientId" WHERE p."lastName" = $1`,
    [patientLastName],
  );
  return row.id;
}

/** Wait until the case page's realtime stream is connected (indicator in the right rail). */
export async function waitForRealtime(page: Page) {
  await expect(page.getByTitle("Live updates connected")).toBeVisible();
}

export const messages = (page: Page) => page.locator('[id^="message-"]');

/**
 * Reload the synthetic demo data, for specs that walk through the demo from
 * its initial state (earlier specs approve decisions, add messages, ...).
 */
export function reseedDemoData() {
  execFileSync("npm", ["run", "db:seed"], {
    cwd: path.resolve(process.cwd(), "packages/database"),
    env: { ...process.env, DATABASE_URL: e2eDatabaseUrl() },
    stdio: "pipe",
  });
}

/** Collect uncaught page errors, console errors and 5xx responses seen by a page. */
export function watchForProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`page error at ${page.url()}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console error at ${page.url()}: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) problems.push(`${response.status()} ${response.url()}`);
  });
  return problems;
}

/** A short unique suffix, so records created by a test can be told apart. */
export const stamp = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
