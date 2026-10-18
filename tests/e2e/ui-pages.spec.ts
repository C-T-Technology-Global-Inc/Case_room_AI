import { expect, test } from "./fixtures";
import { caseIdOf, queryOne, watchForProblems } from "./helpers";

/**
 * Every page renders for every kind of user: a level-1 heading, no uncaught
 * errors, no console errors and no server errors. A broken page anywhere in
 * the app fails here even if no other test walks through it.
 */

const CASE_TABS = ["", "/timeline", "/discussion", "/documents", "/decisions", "/tasks", "/tumor-board", "/handoff", "/audit"];

const ROLES: Array<{ email: string; label: string; extra: string[] }> = [
  { email: "nguyen@riverside.demo", label: "a doctor", extra: ["/cases/new", "SWITCH"] },
  { email: "adams@riverside.demo", label: "a nurse", extra: [] },
  { email: "rivera@riverside.demo", label: "a care coordinator", extra: ["/cases/new"] },
  { email: "admin@riverside.demo", label: "an organization admin", extra: ["/settings/audit", "/cases/new"] },
];

test.describe("every page renders without errors", () => {
  for (const role of ROLES) {
    test(`for ${role.label}`, async ({ signIn }) => {
      const carter = await caseIdOf("Carter");
      const lakeside = await queryOne<{ id: string }>(`SELECT id FROM "Organization" WHERE name LIKE 'Lakeside%'`);
      const page = await signIn(role.email);
      const problems = watchForProblems(page);
      // The switch prompt shown for links into another organization of the same person.
      const extra = role.extra.map((path) => (path === "SWITCH" ? `/switch-organization?organization=${lakeside.id}&next=/dashboard` : path));
      const paths = ["/dashboard", "/cases", "/tasks", "/team", "/settings", ...extra, ...CASE_TABS.map((tab) => `/cases/${carter}${tab}`)];
      for (const path of paths) {
        const response = await page.goto(path);
        expect(response?.status(), path).toBeLessThan(400);
        await expect(page.getByRole("heading", { level: 1 }).first(), path).toBeVisible();
      }
      expect(problems).toEqual([]);
    });
  }

  test("for signed-out visitors: public pages render, private pages lead to sign-in", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const problems = watchForProblems(page);
    for (const [path, heading] of [
      ["/login", "Sign in to your case rooms"],
      ["/signup", "Create an organization"],
      ["/forgot-password", "Reset your password"],
      ["/reset-password/not-a-real-link-0000000000", "Link not valid"],
      ["/signup/confirm/not-a-real-link-0000000000", "Link not valid"],
      ["/invite/not-a-real-invitation", "Invitation not available"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading }), path).toBeVisible();
    }
    for (const path of ["/dashboard", "/cases", "/tasks", "/team", "/settings"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login/);
    }
    expect(problems).toEqual([]);
    await context.close();
  });
});

test("pages fit a 1280-pixel laptop screen without horizontal scrolling", async ({ browser }) => {
  const carter = await caseIdOf("Carter");
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill("nguyen@riverside.demo");
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  for (const path of ["/dashboard", "/cases", "/tasks", "/team", "/settings", ...CASE_TABS.map((tab) => `/cases/${carter}${tab}`)]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(scroll, `${path} is wider than the screen`).toBeLessThanOrEqual(client + 1);
  }
  await context.close();
});
