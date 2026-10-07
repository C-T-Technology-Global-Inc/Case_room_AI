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
