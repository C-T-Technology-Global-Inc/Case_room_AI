import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { caseIdOf, queryOne, waitForRealtime } from "./helpers";
import { linkIn, waitForEmail } from "./outbox";

/** A fresh browser with its own cookies (closed by the caller). */
async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

async function choosePassword(page: Page, password: string) {
  await page.getByLabel(/Choose a password|New password/).fill(password);
  await page.getByLabel("Repeat the password").fill(password);
}

/** Public signup through the emailed confirmation link; returns the signed-in page. */
async function signUp(browser: Browser, email: string, organizationName: string, password: string) {
  const page = await freshPage(browser);
  await page.goto("/signup");
  await page.getByLabel("Organization name").fill(organizationName);
  await page.getByLabel("Your full name").fill("Dr. Synthetic Founder");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Send confirmation link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  const confirmation = await waitForEmail(email, /Confirm your email/);
  await page.goto(linkIn(confirmation, "/signup/confirm/"));
  await choosePassword(page, password);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return page;
}

test("signup is confirmed by email, invitations are emailed, and deactivated members lose access", async ({ browser }) => {
  const stamp = Date.now();
  const founderEmail = `founder.${stamp}@hospital.test`;
  const colleagueEmail = `colleague.${stamp}@hospital.test`;
  const admin = await signUp(browser, founderEmail, `Synthetic Clinic ${stamp}`, "founder-password");
  await expect(admin.getByText(`Synthetic Clinic ${stamp}`).first()).toBeVisible();

  // The admin invites a colleague; the invitation arrives by email.
  await admin.goto("/team");
  await admin.getByLabel("Email").fill(colleagueEmail);
  await admin.getByRole("button", { name: "Create invitation" }).click();
  await expect(admin.getByText(`Invitation emailed to ${colleagueEmail}`).first()).toBeVisible();
  const invitation = await waitForEmail(colleagueEmail, /invited you/);

  const colleague = await freshPage(browser);
  await colleague.goto(linkIn(invitation, "/invite/"));
  await colleague.getByLabel(/Full name/).fill("Dr. Synthetic Colleague");
  await choosePassword(colleague, "colleague-password");
  await colleague.getByRole("button", { name: "Accept invitation" }).click();
  await expect(colleague).toHaveURL(/\/dashboard/);

  // Deactivated: the colleague's next page load shows the notice instead of the organization.
  await admin.reload();
  const row = admin.getByRole("row", { name: /Dr\. Synthetic Colleague/ });
  await row.getByRole("button", { name: "Deactivate" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Deactivate" }).click();
  await expect(row.getByText(/Deactivated/)).toBeVisible();
  await colleague.goto("/dashboard");
  await expect(colleague).toHaveURL(/\/account-inactive/);
  await expect(colleague.getByRole("heading", { name: "Access deactivated" })).toBeVisible();

  // Reactivated: access is back with the same account.
  await row.getByRole("button", { name: "Reactivate" }).click();
  await expect(row.getByRole("button", { name: "Deactivate" })).toBeVisible();
  await colleague.goto("/dashboard");
  await expect(colleague).toHaveURL(/\/dashboard/);

  await Promise.all([admin.context().close(), colleague.context().close()]);
});

test("a forgotten password is reset by email and the reset signs out other sessions", async ({ browser }) => {
  const stamp = Date.now();
  const email = `reset.${stamp}@hospital.test`;
  const oldSession = await signUp(browser, email, `Reset Clinic ${stamp}`, "original-password");

  const visitor = await freshPage(browser);
  await visitor.goto("/login");
  await visitor.getByRole("link", { name: "Forgot password?" }).click();
  // Wait for the new page: the sign-in page has an Email field too.
  await expect(visitor.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await visitor.getByLabel("Email").fill(email);
  await visitor.getByRole("button", { name: "Send reset link" }).click();
  await expect(visitor.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const reset = await waitForEmail(email, /Reset your/);
  await visitor.goto(linkIn(reset, "/reset-password/"));
  await choosePassword(visitor, "replacement-password");
  await visitor.getByRole("button", { name: "Save new password" }).click();
  await expect(visitor).toHaveURL(/\/dashboard/);
  await waitForEmail(email, /password was changed/);

  // The session from before the reset no longer works.
  await oldSession.goto("/dashboard");
  await expect(oldSession).toHaveURL(/\/login/);

  // The link works only once.
  await oldSession.goto(linkIn(reset, "/reset-password/"));
  await expect(oldSession.getByRole("heading", { name: "Link not valid" })).toBeVisible();

  // Changing the password in Settings keeps this session and confirms it.
  await visitor.goto("/settings");
  await visitor.getByLabel("Current password").fill("replacement-password");
  await choosePassword(visitor, "settings-password");
  await visitor.getByRole("button", { name: "Change password" }).click();
  await expect(visitor.getByText("Your password was changed. Your other sessions were signed out.")).toBeVisible();

  await Promise.all([oldSession.context().close(), visitor.context().close()]);
});

test("a deactivated member's open case page loses its live connection and leaves the case", async ({ signIn }) => {
  const carter = await caseIdOf("Carter");
  const member = await queryOne<{ id: string }>(`SELECT id FROM "User" WHERE email = 'rivera@riverside.demo'`);
  try {
    const viewer = await signIn("rivera@riverside.demo");
    await viewer.goto(`/cases/${carter}/discussion`);
    await waitForRealtime(viewer);

    const admin = await signIn("admin@riverside.demo");
    await admin.goto("/team");
    const row = admin.getByRole("row", { name: /rivera@riverside\.demo/ });
    await row.getByRole("button", { name: "Deactivate" }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "Deactivate" }).click();
    await expect(row.getByText(/Deactivated/)).toBeVisible();

    // Without any action by the viewer, the stream is revoked and the page reloads to the notice.
    await expect(viewer).toHaveURL(/\/account-inactive/, { timeout: 15_000 });
  } finally {
    // Other tests use the demo organization; never leave the account deactivated.
    await queryOne(`UPDATE "User" SET "deactivatedAt" = NULL WHERE id = $1 RETURNING id`, [member.id]);
  }
});
