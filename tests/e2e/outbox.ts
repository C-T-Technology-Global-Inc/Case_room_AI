import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";

/** Where the app under test writes account emails (EMAIL_TRANSPORT=file, see playwright.config.ts). */
export const E2E_OUTBOX_DIR = path.resolve(process.cwd(), "test-results/e2e-outbox");

interface SentEmail {
  to: string;
  subject: string;
  text: string;
  sentAt: string;
}

async function readOutbox(): Promise<SentEmail[]> {
  const files = await readdir(E2E_OUTBOX_DIR).catch(() => [] as string[]);
  const emails = await Promise.all(files.filter((f) => f.endsWith(".json")).map(async (f) => JSON.parse(await readFile(path.join(E2E_OUTBOX_DIR, f), "utf8")) as SentEmail));
  return emails.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

export async function clearOutbox() {
  await rm(E2E_OUTBOX_DIR, { recursive: true, force: true });
}

/** The newest email to `to` whose subject matches, waiting for it to arrive. */
export async function waitForEmail(to: string, subject: RegExp): Promise<SentEmail> {
  let found: SentEmail | undefined;
  await expect
    .poll(
      async () => {
        found = (await readOutbox()).filter((email) => email.to === to && subject.test(email.subject)).at(-1);
        return Boolean(found);
      },
      { message: `email to ${to} matching ${subject}` },
    )
    .toBe(true);
  return found!;
}

/** The first link to this app in an email's text. */
export function linkIn(email: SentEmail, pathPrefix: string): string {
  const match = email.text.match(new RegExp(`https?://[^\\s]+${pathPrefix.replace(/\//g, "\\/")}[^\\s]*`));
  if (!match) throw new Error(`No ${pathPrefix} link in "${email.subject}"`);
  return match[0];
}
