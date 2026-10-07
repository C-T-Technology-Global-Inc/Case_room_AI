import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { DEMO_PASSWORD } from "./helpers";

/**
 * `signIn(email)` opens a separate browser context (own cookies, own identity)
 * and signs in. Every context a test opens is closed after it, so no viewer or
 * realtime stream outlives its test.
 */
export const test = base.extend<{ signIn: (email: string) => Promise<Page> }>({
  signIn: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (email: string) => {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(DEMO_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/dashboard/);
      return page;
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

export { expect };
